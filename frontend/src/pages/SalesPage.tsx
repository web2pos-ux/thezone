import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_URL } from '../config/constants';
import { isMasterPosPin } from '../constants/masterPosPin';
import { isWeb2posDemoBuild } from '../utils/web2posDemoBuild';
import { quitToOsFromPos } from '../utils/quitToOs';
import { firebaseDb } from '../config/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import ReservationCreateModal from '../components/reservations/ReservationCreateModal';
import WaitingListModal from '../components/waiting/WaitingListModal';
import VirtualKeyboard from '../components/order/VirtualKeyboard';
import PinInputModal from '../components/PinInputModal';
import clockInOutApi, { ClockedInEmployee } from '../services/clockInOutApi';
import { useMenuCache } from '../contexts/MenuCacheContext';
import { useNetworkSyncStatus } from '../contexts/NetworkSyncStatusContext';
import { resolveMenuIdentifiers } from '../utils/menuIdentifier';
import { fetchMenuStructure } from '../utils/menuDataFetcher';
import { ensureOrderBootstrap } from '../utils/orderBootstrap';
import ServerSelectionModal from '../components/ServerSelectionModal';
import {
  clearServerAssignment,
  loadServerAssignment,
  saveServerAssignment,
  POS_TABLE_MAP_SERVER_SESSION_ID,
} from '../utils/serverAssignmentStorage';
import { formatNameForDisplay, parseCustomerName } from '../utils/nameParser';
import { assignDailySequenceNumbers } from '../utils/orderSequence';
import { getLocalDatetimeString, getLocalDateString } from '../utils/datetimeUtils';
import {
  readTableMapTogoPanelSplitFromStorage,
  readBistroTableMapLeftPercentFromStorage,
  bistroPanelUiScaleFromLeftPct,
  leftPercentFromSplitPreset,
  togoPanelUiScaleFromPresets,
  TABLE_MAP_TOGO_PANEL_SPLIT_KEY,
  TABLE_MAP_BISTRO_PANEL_SPLIT_KEY,
  TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT,
  type TableMapTogoPanelSplitPreset,
} from '../utils/tableMapTogoPanelSplit';
import BistroTabPanel from '../components/bistro/BistroTabPanel';
import BistroContainerModal from '../components/bistro/BistroContainerModal';
import { filterOrdersForBistroPanel, filterOrdersForContainer } from '../utils/bistroOrderHelpers';
import { fetchOrdersForBistroSession } from '../utils/bistroSessionOrders';
import { syncBistroTableMapFromOrders } from '../utils/bistroTableMapSync';
import {
  printReceipt,
  printKitchenTicket,
  printBill,
  openCashDrawer,
  armPanelTogoPayKitchenSuppress,
  disarmPanelTogoPayKitchenSuppress,
  isPanelTogoPayKitchenSuppressActive,
} from '../utils/printUtils';
import { SOFT_NEO, OH_ACTION_NEO, PAY_NEO, PAY_NEO_CANVAS, PAY_NEO_PRIMARY_BLUE, PAY_NEO_PRIMARY_AMBER, PAY_NEO_KEY_FLAT, PAY_KEYPAD_KEY, NEO_MODAL_BTN_PRESS, NEO_PREP_TIME_BTN_PRESS, NEO_COLOR_BTN_PRESS, PCM_RX_ROUND, NEO_PRESS_INSET_ONLY_NO_SHIFT, NEO_PRESS_INSET_AMBER_NO_SHIFT, NEO_COLOR_BTN_PRESS_NO_SHIFT, MODAL_CLOSE_X_RAISED_STYLE, MODAL_CLOSE_X_ON_SLATE700_RAISED_STYLE, NEO_CLOSE_X_ON_SLATE700_PRESS_INSET_NO_SHIFT } from '../utils/softNeumorphic';
import { calculateOrderPricing } from '../utils/orderPricing';
import { fetchPickupDetailItemsPreferFirebase } from '../utils/onlineOrderPickupDetailItems';
import { MoveMergeHistoryModal } from '../components/MoveMergeHistoryModal';
import { SimplePartialSelectionModal } from '../components/SimplePartialSelectionModal';
import { PartialSelectionPayload } from '../types/MoveMergeTypes';
import TablePaymentModal from '../components/PaymentModal';
import DayClosingModal from '../components/DayClosingModal';
import DayOpeningModal from '../components/DayOpeningModal';
import OrderDetailModal, { OrderData, OrderChannelType } from '../components/OrderDetailModal';
import PaymentCompleteModal from '../components/PaymentCompleteModal';
import TipEntryModal from '../components/TipEntryModal';
import PickupOrderModal, { PickupOrderConfirmData } from '../components/PickupOrderModal';
import { PickupChannelGlassButton } from '../components/PickupChannelGlassButton';
// SoldOutModal removed - Sold Out is handled in OrderPage

/** Gift Card 모달 — Sell/Balance 등 컬러 CTA (PAY_NEO 톤, 눌림은 NEO_COLOR_BTN_PRESS) */
const GC_NEO_AMBER: React.CSSProperties = {
	...PAY_NEO.raised,
	background: 'linear-gradient(145deg, #fbbf24, #d97706)',
	color: '#fff',
	boxShadow: '5px 5px 12px rgba(180, 83, 9, 0.4), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};
const GC_NEO_GREEN: React.CSSProperties = {
	...PAY_NEO.raised,
	background: 'linear-gradient(145deg, #22c55e, #16a34a)',
	color: '#fff',
	boxShadow: '5px 5px 12px rgba(22, 101, 52, 0.4), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};

/** Online Settings 모달 — 네오 볼록 버튼 눌림 (인셋 그림자 + 스케일) */
const ONLINE_NEO_PRESS = `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS} touch-manipulation`;

/** Online Settings Utility 탭 — 보라 CTA (PAY_NEO raised 계열) */
const PAY_NEO_UTILITY_SAVE: React.CSSProperties = {
	...PAY_NEO.raised,
	background: 'linear-gradient(145deg, #8b5cf6, #6d28d9)',
	color: '#fff',
	boxShadow: '5px 5px 12px rgba(91, 33, 182, 0.42), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};

/** Pickup List / Togo Void 모달 — Primary Void (PaymentModal PAY_NEO 톤 + 눌림 NEO_COLOR_BTN_PRESS) */
const VOID_MODAL_NEO_RED: React.CSSProperties = {
	...PAY_NEO.raised,
	background: 'linear-gradient(145deg, #ef4444, #b91c1c)',
	color: '#fff',
	boxShadow: '5px 5px 12px rgba(127, 29, 29, 0.5), -3px -3px 10px rgba(255, 255, 255, 0.18)',
};

/** Void 모달 — PAY_NEO.key / PAY_KEYPAD_KEY: 스케일 + 인셋 그림자 눌림 (Online Settings와 동일 결합) */
/** Void 모달 키/패드 — PinInput / Prep Time과 동일 오목(모달+프렙 결합) */
const VOID_MODAL_KEY_PRESS = `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS} touch-manipulation`;

/** Void 모달 레드 Primary — 컬러 인셋만(아래로 밀림 없음) */
const VOID_MODAL_PRIMARY_PRESS = `${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`;

/** Void/Clock 닫기 등 — PAY_NEO_KEY_FLAT과 동일 */
const MODAL_CLOSE_X_KEY: React.CSSProperties = PAY_NEO_KEY_FLAT;

/** 카드 상세 모달(온라인/투고/딜리버리) — 아이템·세금 블록만 플랫 */
const CARD_DETAIL_ITEMS_TAX_FLAT: React.CSSProperties = {
	background: PAY_NEO_CANVAS,
	borderRadius: 14,
	border: '1px solid #c5cad4',
	boxShadow: 'none',
};

/** 카드 상세 모달 — 아이템 목록만 PAY_NEO_CANVAS(#e0e5ec)보다 아주 약간만 밝게 */
const CARD_DETAIL_ITEMS_LIST_SLIGHT: React.CSSProperties = {
	...CARD_DETAIL_ITEMS_TAX_FLAT,
	background: '#ecf1f7',
};

/** OrderDetailModal 등에서 넘긴 __togoTotals.total이 0이면 typeof number만으로 채택되어 결제 모달이 $0이 됨 — 양수일 때만 태그 합계 사용, 아니면 재계산·fullOrder.total 보강 */
function pickOnlineTogoPaymentTotals(
  order: any,
  computeFromItems: () => { subtotal: number; tax: number; taxLines: Array<{ name: string; amount: number }>; total: number }
): { subtotal: number; tax: number; taxLines: Array<{ name: string; amount: number }>; total: number } {
  const t = (order as any)?.__togoTotals || (order as any)?.fullOrder?.__togoTotals || null;
  const taggedTotal = t != null ? Number((t as any).total) : NaN;
  if (t != null && typeof t === 'object' && Number.isFinite(taggedTotal) && taggedTotal > 0) {
    const subtotal = Number((t as any).subtotal ?? 0);
    const tax = Number((t as any).tax ?? 0);
    const taxLines = Array.isArray((t as any).taxLines)
      ? (t as any).taxLines
      : tax > 0.0001
        ? [{ name: 'Tax', amount: tax }]
        : [];
    return { subtotal, tax, taxLines, total: taggedTotal };
  }
  const fromItems = computeFromItems();
  if (Number.isFinite(fromItems.total) && fromItems.total > 0) {
    return fromItems;
  }
  const fo = order?.fullOrder;
  const exTotal = Number(
    (fo as any)?.total ??
      (fo as any)?.grandTotal ??
      (fo as any)?.orderTotal ??
      (order as any)?.total ??
      (order as any)?.grandTotal ??
      0
  );
  const exSub = Number((fo as any)?.subtotal ?? (order as any)?.subtotal ?? 0);
  const exTax = Number(
    (fo as any)?.tax ?? (order as any)?.tax ?? Math.max(0, Number((exTotal - exSub).toFixed(2)))
  );
  if (Number.isFinite(exTotal) && exTotal > 0) {
    return {
      subtotal: Number.isFinite(exSub) ? exSub : 0,
      tax: exTax,
      taxLines: exTax > 0.0001 ? [{ name: 'Tax', amount: exTax }] : [],
      total: exTotal,
    };
  }
  return fromItems;
}

/** 투고/온라인/딜리버리 카드 상세 모달 — 주문에 subtotal·tax가 비어 있거나 0일 때 라인 합계·pricing으로 보강 */
function computeCardDetailModalTotals(cdOrder: any, cdItems: any[]) {
  const fo = cdOrder?.fullOrder || {};
  const rawItems = (Array.isArray(cdItems) && cdItems.length > 0 ? cdItems : (fo.items || [])) as any[];
  return pickOnlineTogoPaymentTotals(
    { ...cdOrder, fullOrder: { ...fo, items: rawItems } },
    () => {
      try {
        if (!rawItems.length) {
          return { subtotal: 0, tax: 0, taxLines: [], total: 0 };
        }
        const normalizedItems = rawItems.map((it: any) => {
          let discountObj: any = it.discount ?? null;
          if (!discountObj && it.discount_json) {
            try {
              discountObj = typeof it.discount_json === 'string' ? JSON.parse(it.discount_json) : it.discount_json;
            } catch {
              discountObj = null;
            }
          }
          return {
            id: it.id ?? it.item_id ?? it.itemId ?? it.order_line_id ?? it.orderLineId ?? `${it.name || 'line'}`,
            orderLineId: it.order_line_id ?? it.orderLineId,
            name: it.name,
            type: it.type,
            quantity: it.quantity,
            price: typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0),
            totalPrice: it.total_price ?? it.totalPrice,
            modifiers: it.modifiers ?? it.options ?? [],
            memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
            discount: discountObj,
            guestNumber: it.guestNumber ?? it.guest_number,
            taxGroupId: it.taxGroupId ?? it.tax_group_id,
            void_id: it.void_id,
            voidId: it.voidId,
            is_void: it.is_void,
          };
        });
        const pricing = calculateOrderPricing(normalizedItems as any);
        const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
        const storedTotalRaw = Number(
          (cdOrder.total ?? fo.total ?? fo.grandTotal ?? fo.orderTotal ?? pricing.totals.total ?? 0) as any
        );
        const storedTotal =
          Number.isFinite(storedTotalRaw) && storedTotalRaw > 0
            ? Number(storedTotalRaw.toFixed(2))
            : Number((pricing.totals.total || 0).toFixed(2));
        const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
        return {
          subtotal: netSubtotal,
          tax: derivedTax,
          taxLines: derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [],
          total: storedTotal,
        };
      } catch {
        return { subtotal: 0, tax: 0, taxLines: [], total: 0 };
      }
    }
  );
}

/** 투고 패널 Today's Reservations: 예약 시각 기준 15분 초과 지난 항목은 스크롤로 밀어 다음 예약이 보이게 (예약 4건 이하는 자동 스크롤 없음) */
const TOGO_TODAY_RES_STALE_AFTER_MS = 15 * 60 * 1000;

function togoReservationTimeToMs(res: any, todayStr: string): number | null {
  const t = String(res?.reservation_time ?? res?.time ?? '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = String(m[1]).padStart(2, '0');
  const mm = String(m[2]).padStart(2, '0');
  const d = new Date(`${todayStr}T${hh}:${mm}:00`);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** 첫 번째로 뷰포트 상단에 두고 싶은 인덱스: 예약 시각+15분이 아직 안 지난 첫 항목. 파싱 불가면 0, 전부 지났으면 length */
function getTogoTodayReservationScrollToIndex(reservations: any[], todayStr: string): number {
  const now = Date.now();
  for (let i = 0; i < reservations.length; i++) {
    const ms = togoReservationTimeToMs(reservations[i], todayStr);
    if (ms == null) return i;
    if (now <= ms + TOGO_TODAY_RES_STALE_AFTER_MS) return i;
  }
  return reservations.length;
}

interface TableElement {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  text: string;
  fontSize: number;
  color: string;
  status?: string;
  current_order_id?: number | null;
  /** 연결된 주문의 서버 (테이블맵 API JOIN) — 시프트 이전 후 라벨 동기화용 */
  order_server_name?: string | null;
  order_server_id?: number | string | null;
}

interface CustomerSuggestion {
  key: string;
  name: string;
  phone: string;
  phoneRaw: string;
  orders: any[];
}

interface HistoryOrderDetailPayload {
  order: any;
  items: any[];
  adjustments: any[];
}

type VirtualOrderChannel = 'togo' | 'online' | 'delivery';

interface VirtualOrderMeta {
  virtualTableId: string;
  channel: VirtualOrderChannel;
}

type MoveEndpointKind = 'table' | 'virtual';

interface OnlineQueueCard {
  id: string;
  number: string | number;
  localOrderId?: number | string | null;
  time: string;
  phone: string;
  name: string;
  items: string[];
  virtualChannel: VirtualOrderChannel;
  virtualTableId: string;
  fullOrder?: any; // ì „ì²´ ì£¼ë¬¸ ë°ì´í„° ì¶”ê°€
  placedTime?: string | Date; // ì£¼ë¬¸ ì‹œê°„
  pickupTime?: string | Date | null; // í”½ì—… ì‹œê°„
  total?: number; // ì´ì•¡
  sequenceNumber?: number; // ìˆœì„œë²ˆí˜¸
  status?: string; // ì£¼ë¬¸ ìƒíƒœ (pending, confirmed, preparing, ready, completed, cancelled)
  /** Firebase / manual online order id shown in Togo panel (priority over phone / POS) */
  onlineOrderNumber?: string;
}

/** SQLite `orders.id` for GET /orders/:id and void API. Online queue cards use Firebase string `id` — do not use that for API. */
function resolveSqliteOrderIdForVoid(
  order: any,
  orderType: OrderChannelType | string | null | undefined
): string | number | null {
  const t = String(orderType || '').toLowerCase();
  if (t === 'delivery') {
    const v = order?.order_id ?? order?.id;
    return v != null && v !== '' ? v : null;
  }
  if (t === 'online') {
    const a = order?.localOrderId ?? order?.fullOrder?.localOrderId ?? order?.order_id;
    if (a != null && a !== '') return a;
    const id = order?.id;
    if (typeof id === 'number' && Number.isFinite(id)) return id;
    if (typeof id === 'string' && /^\d+$/.test(id.trim())) return id.trim();
    return null;
  }
  if (t === 'pos') {
    return null;
  }
  const v = order?.id;
  return v != null && v !== '' ? v : null;
}

/** Pickup List 행 ↔ 투고패널 SQLite 행 매칭 */
function pickupRowMatchesTogoPanelOrder(row: any, o: any): boolean {
  if (row == null || o == null) return false;
  const rid = String(row?.id ?? '').trim();
  const oid = String(o?.id ?? '').trim();
  if (rid && oid && rid === oid) return true;
  const rOid = String(row?.order_id ?? row?.orderId ?? '').trim();
  if (rOid && oid && rOid === oid) return true;
  const dm = String((o as any)?.deliveryMetaId ?? (o as any)?.delivery_meta_id ?? '').trim();
  const tid = String(row?.table_id ?? '').toUpperCase();
  if (dm && tid.startsWith('DL') && tid.slice(2) === dm) return true;
  return false;
}

/** Pickup List 행 ↔ 투고패널 온라인 카드 매칭 */
function pickupRowMatchesOnlineCard(row: any, card: any): boolean {
  if (row == null || card == null) return false;
  const rid = String(row?.id ?? '').trim();
  const fbRow = String(row?.firebase_order_id ?? row?.firebaseOrderId ?? '').trim();
  const fo = card?.fullOrder || {};
  const cid = String(card?.id ?? '').trim();
  if (fbRow && cid && fbRow === cid) return true;
  const loc = card?.localOrderId ?? fo?.localOrderId ?? fo?.order_id;
  if (loc != null && String(loc).trim() !== '' && rid && String(loc) === rid) return true;
  const foid = fo?.order_id != null ? String(fo.order_id).trim() : '';
  if (foid && rid && foid === rid) return true;
  return false;
}

function panelTogoOrderIsPaidForPickupSync(o: any): boolean {
  const fo = o?.fullOrder || {};
  const stUp = String(o?.status ?? fo?.status ?? '').toUpperCase();
  const stLo = String(o?.status ?? '').toLowerCase();
  const paySt = String(fo?.paymentStatus ?? fo?.payment_status ?? '').toLowerCase();
  return (
    stUp === 'PAID' ||
    stUp === 'COMPLETED' ||
    stUp === 'CLOSED' ||
    stLo === 'paid' ||
    stLo === 'completed' ||
    stLo === 'closed' ||
    paySt === 'paid' ||
    paySt === 'completed' ||
    fo?.paid === true ||
    fo?.isPaid === true
  );
}

/**
 * 투고패널 온라인 카드: Pay 완료 후 READY 라벨 + 스와이프 픽업(삭제) 동일 기준.
 * Firebase status·paymentStatus·SQLite 반영 전에도 맞추기 위해 소문자 status·READY 계열도 포함.
 */
function onlineQueueCardIsPaidReady(card: any): boolean {
  const fo = card?.fullOrder || {};
  const raw = card?.status ?? fo?.status ?? '';
  const st = String(raw).toUpperCase();
  const stLo = String(raw).toLowerCase();
  const paySt = String(fo?.paymentStatus ?? fo?.payment_status ?? '').toLowerCase();
  return (
    st === 'PAID' ||
    st === 'COMPLETED' ||
    st === 'CLOSED' ||
    st === 'READY' ||
    st === 'READY_FOR_PICKUP' ||
    st === 'PREPARED' ||
    paySt === 'paid' ||
    paySt === 'completed' ||
    fo?.paid === true ||
    fo?.isPaid === true ||
    stLo === 'completed' ||
    stLo === 'paid' ||
    stLo === 'closed' ||
    stLo === 'ready'
  );
}

function panelOnlineCardIsPaidForPickupSync(card: any): boolean {
  return onlineQueueCardIsPaidReady(card);
}

function pickupRowHiddenBySwipeRemovedKeys(row: any, removedKeys: ReadonlySet<string>): boolean {
  const hit = (v: any) => {
    const t = String(v ?? '').trim();
    return t !== '' && removedKeys.has(t);
  };
  if (hit(row?.id)) return true;
  if (hit(row?.firebase_order_id)) return true;
  if (hit(row?.firebaseOrderId)) return true;
  if (hit(row?.online_order_number)) return true;
  if (hit(row?.onlineOrderNumber)) return true;
  if (hit(row?.order_id)) return true;
  const tid = String(row?.table_id ?? '').toUpperCase();
  if (tid.startsWith('DL') && hit(tid.slice(2))) return true;
  return false;
}

/**
 * Pickup List를 투고패널(togoOrders + onlineQueueCards)과 동기화.
 * - 패널에서 결제 완료로 보이면 SQLite가 PENDING이어도 행 status를 PAID로 표시
 * - 패널 스와이프 숨김 키와 맞는 행은 목록에서 제외(픽업 완료 직후 부활 방지)
 */
function applyPanelSyncToPickupListRows(
  rows: any[],
  togoPanel: any[],
  onlinePanel: any[],
  removedKeys: ReadonlySet<string>
): any[] {
  if (!Array.isArray(rows)) return rows;
  const out: any[] = [];
  for (const row of rows) {
    if (pickupRowHiddenBySwipeRemovedKeys(row, removedKeys)) continue;
    let paidFromPanel = false;
    for (const o of togoPanel || []) {
      if (pickupRowMatchesTogoPanelOrder(row, o) && panelTogoOrderIsPaidForPickupSync(o)) {
        paidFromPanel = true;
        break;
      }
    }
    if (!paidFromPanel) {
      for (const c of onlinePanel || []) {
        if (pickupRowMatchesOnlineCard(row, c) && panelOnlineCardIsPaidForPickupSync(c)) {
          paidFromPanel = true;
          break;
        }
      }
    }
    if (paidFromPanel) {
      const cur = String(row?.status || '').toUpperCase();
      if (
        cur !== 'PICKED_UP' &&
        cur !== 'VOIDED' &&
        cur !== 'VOID' &&
        cur !== 'REFUNDED' &&
        cur !== 'CANCELLED'
      ) {
        out.push({ ...row, status: 'PAID' });
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

const VIRTUAL_TABLE_POOL: Record<VirtualOrderChannel, { prefix: string; limit: number }> = {
  togo: { prefix: 'TG', limit: 500 },
  online: { prefix: 'OL', limit: 500 },
  delivery: { prefix: 'DL', limit: 500 },
};

const normalizeVirtualOrderChannel = (
  value?: string | null,
  fallback: VirtualOrderChannel = 'togo'
): VirtualOrderChannel => {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase();
  if (key === 'online' || key === 'web' || key === 'qr') return 'online';
  if (key === 'delivery' || key === 'ubereats' || key === 'doordash' || key === 'skipthedishes' || key === 'fantuan') return 'delivery';
  if (key === 'togo' || key === 'pickup' || key === 'takeout') return 'togo';
  return fallback;
};

const buildVirtualTableCode = (channel: VirtualOrderChannel, index: number) => {
  const { prefix } = VIRTUAL_TABLE_POOL[channel];
  return `${prefix}-${index.toString().padStart(4, '0')}`;
};

const allocateVirtualTableId = (channel: VirtualOrderChannel, used: Set<string>) => {
  const { limit, prefix } = VIRTUAL_TABLE_POOL[channel];
  for (let idx = 1; idx <= limit; idx += 1) {
    const candidate = buildVirtualTableCode(channel, idx);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  let fallbackIndex = limit + 1;
  let candidate = buildVirtualTableCode(channel, fallbackIndex);
  while (used.has(candidate)) {
    fallbackIndex += 1;
    candidate = buildVirtualTableCode(channel, fallbackIndex);
  }
  console.warn(`[VIRTUAL-ID] ${prefix} í’€ ì†Œì§„ - ìž„ì‹œ ID ${candidate} ì‚¬ìš©`);
  return candidate;
};

const buildVirtualTableMeta = (
  orders: Array<{ id: string | number; channel?: VirtualOrderChannel; virtualTableId?: string | null }>,
  prevMeta: Record<string, VirtualOrderMeta>,
  defaultChannel: VirtualOrderChannel
) => {
  const used = new Set<string>();
  const next: Record<string, VirtualOrderMeta> = {};
  orders.forEach((order) => {
    const key = String(order.id);
    const channel = order.channel || defaultChannel;
    const serverProvidedId = typeof order.virtualTableId === 'string' && order.virtualTableId
      ? order.virtualTableId.trim().toUpperCase()
      : null;
    const existing = prevMeta?.[key]?.virtualTableId;
    let assign: string | null = null;
    if (serverProvidedId && !used.has(serverProvidedId)) {
      assign = serverProvidedId;
    } else if (existing && !used.has(existing)) {
      assign = existing;
    } else {
      assign = allocateVirtualTableId(channel, used);
    }
    used.add(assign);
    next[key] = { virtualTableId: assign, channel };
  });
  return next;
};

const createInitialOnlineQueueCards = (): OnlineQueueCard[] => {
  // ë¹ˆ ë°°ì—´ë¡œ ì‹œìž‘ - ì‹¤ì œ ë°ì´í„°ëŠ” loadOnlineOrdersì—ì„œ ê°€ì ¸ì˜´
  return [];
};

interface ScreenSize {
  width: number;
  height: number;
  scale: number;
}

const LAYOUT_SETTINGS_SNAPSHOT_KEY = 'orderLayout:layoutSettingsSnapshot';

const formatPickupDateLabel = (date = new Date()) => {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate().toString().padStart(2, '0');
  const weekday = date.toLocaleString('en-US', { weekday: 'short' });
  return `${month}-${day} (${weekday})`;
};

const getCurrentAmPm = () => (new Date().getHours() >= 12 ? 'PM' : 'AM');

const formatHeaderClockLabel = (date = new Date()) => {
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase(); // e.g. APR (table map header)
  const day = date.getDate().toString().padStart(2, '0');
  const weekday = date.toLocaleString('en-US', { weekday: 'short' });
  const dateLabel = `${month}-${day} (${weekday})`;
  const timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); // e.g. 05:12 PM
  return `${dateLabel} ${timeLabel}`;
};

const formatMinutesToTime = (minutes: number) => {
  const normalized = Math.max(0, minutes);
  const hrs = Math.floor(normalized / 60) % 24;
  const mins = normalized % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

/** Utility(Firebase) Bag Fee on/off·금액 → POS Extra1용 localStorage (세금/프린터 미포함) */
const syncPosBagFeeLocalFromUtilityBagFee = (bagFee: { enabled: boolean; amount: number }) => {
  try {
    localStorage.setItem('table_bag_fee_enabled', bagFee.enabled ? '1' : '0');
    localStorage.setItem('table_bag_fee_value', String(Number(bagFee.amount) || 0));
    window.dispatchEvent(new CustomEvent('pos_bag_fee_from_utility'));
  } catch {}
};

/** SSE `new_order`와 `loadOnlineOrders` 폴링이 같은 주문에 대해 자동 수락·키친 프린트를 두 번 호출하지 않도록 */
function claimOnlineAutoAcceptPrintOnce(
  storeRef: React.MutableRefObject<Set<string>>,
  orderId: string | undefined | null
): boolean {
  if (orderId == null || String(orderId).trim() === '') return false;
  const key = String(orderId);
  const s = storeRef.current;
  if (s.has(key)) return false;
  s.add(key);
  if (s.size > 400) {
    const keys = Array.from(s);
    const dropCount = s.size - 200;
    for (let i = 0; i < dropCount; i++) {
      s.delete(keys[i]);
    }
  }
  return true;
}

/** New Delivery 모달 — 채널 버튼 톤과 맞춘 Order # 입력란 왼쪽 라벨 색 */
const DELIVERY_ORDER_MODAL_CHANNEL_BADGE: Record<
  'UberEats' | 'Doordash' | 'SkipTheDishes' | 'Fantuan',
  { label: string; color: string }
> = {
  UberEats: { label: 'Uber Eats', color: '#047857' },
  Doordash: { label: 'DoorDash', color: '#c41f00' },
  SkipTheDishes: { label: 'Skip', color: '#ea580c' },
  Fantuan: { label: 'Fantuan', color: '#0f766e' },
};

type TableReservationDetailRow = { name: string; time: string; partySize: number };

/** 맵 복원 시: Available 테이블·같은 테이블의 주문 ID 변경 시 예약 표시 캐시 제거 (결제 후 잔상 방지) */
function purgeStaleTableReservationMaps(
  elements: any[],
  names: Record<string, string>,
  details: Record<string, TableReservationDetailRow>,
  prevOrderIdByTable: Record<string, string>
): {
  names: Record<string, string>;
  details: Record<string, TableReservationDetailRow>;
  nextOrderIdByTable: Record<string, string>;
} {
  const namesOut = { ...names };
  const detailsOut = { ...details };
  for (const el of elements) {
    const st = String(el?.status || '');
    if (st === 'Available' || st === 'Cleaning') {
      const id = String(el.id);
      delete namesOut[id];
      delete detailsOut[id];
    }
  }
  const nextOrderIdByTable: Record<string, string> = {};
  for (const el of elements) {
    const tid = String(el.id);
    const st = String(el?.status || '');
    const oid =
      el?.current_order_id != null && String(el.current_order_id) !== ''
        ? String(el.current_order_id)
        : '';
    if ((st === 'Occupied' || st === 'Payment Pending') && oid) {
      const prev = prevOrderIdByTable[tid];
      if (prev && prev !== oid) {
        delete namesOut[tid];
        delete detailsOut[tid];
      }
      nextOrderIdByTable[tid] = oid;
    }
  }
  return { names: namesOut, details: detailsOut, nextOrderIdByTable };
}

/** 투고 패널 카드: 해당 주문을 받은 서버 이름 (DB 필드 → order 스코프 localStorage) */
function pickPanelOrderServerLabel(order: any): string {
  if (!order) return '';
  const fo = order.fullOrder || {};
  const raw =
    order.serverName ||
    order.server_name ||
    fo.server_name ||
    fo.serverName ||
    '';
  let t = String(raw || '').trim();
  if (t) return t;
  try {
    const oid = order.order_id ?? order.id ?? fo?.localOrderId ?? fo?.id;
    if (oid != null && oid !== '') {
      const a = loadServerAssignment('order', oid);
      if (a?.serverName && String(a.serverName).trim()) return String(a.serverName).trim();
    }
  } catch {}
  return '';
}

const SalesPage: React.FC = () => {
  const [tableElements, setTableElements] = useState<TableElement[]>([]);
  const [screenSize, setScreenSize] = useState({ width: '1024', height: '768', scale: 1 });
  const [loading, setLoading] = useState(true);
  const [frameReady, setFrameReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isBistroSalesRoute = location.pathname === '/bistro';
  const networkSync = useNetworkSyncStatus();

  // Floor ê´€ë ¨ ìƒíƒœ
  const [selectedFloor, setSelectedFloor] = useState('1F');
  const [floorList, setFloorList] = useState<string[]>([]);
  const [firstElementColors, setFirstElementColors] = useState<{ [key: string]: string }>({});
  const [pressedTableId, setPressedTableId] = useState<string | null>(null);
  const [pressedButton, setPressedButton] = useState<string | null>(null);
  const [tableOccupiedTimes, setTableOccupiedTimes] = useState<Record<string, number>>({});
  const [tableReservationNames, setTableReservationNames] = useState<Record<string, string>>({});
  const [tableReservationDetails, setTableReservationDetails] = useState<Record<string, TableReservationDetailRow>>({});
  const [tableHoldInfo, setTableHoldInfo] = useState<Record<string, { customerName: string; reservationTime: string; reservationId: string }>>({});
  /** 테이블맵 fetch 직전 점유 주문 ID — 동일 테이블에 다른 주문이 잡히면 예약 캐시 무효화 */
  const tableMapOrderIdByTableRef = useRef<Record<string, string>>({});
  const [showReservedActionModal, setShowReservedActionModal] = useState<{ tableId: string; tableName: string; isHoldOrigin: boolean; customerName: string; reservationTime: string } | null>(null);

  const persistOccupiedTimes = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(`occupiedTimes_${selectedFloor}`, JSON.stringify(next));
      } catch {}
      return next;
    },
    [selectedFloor]
  );

  const setOccupiedTimestamp = useCallback(
    (tableId: string | number | null | undefined, timestamp: number | null | undefined) => {
      if (!tableId || typeof timestamp !== 'number' || Number.isNaN(timestamp)) return;
      setTableOccupiedTimes((prev) => {
        const key = String(tableId);
        if (prev[key] === timestamp) return prev;
        const next = { ...prev, [key]: timestamp };
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );

  const clearOccupiedTimestamp = useCallback(
    (tableId: string | number | null | undefined) => {
      if (!tableId) return;
      setTableOccupiedTimes((prev) => {
        const key = String(tableId);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );

  const removeReservationDisplayCacheForTable = useCallback(
    (tableId: string | number | null | undefined) => {
      if (tableId == null || tableId === '') return;
      const key = String(tableId);
      setTableReservationDetails((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        try {
          localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(next));
        } catch {}
        return next;
      });
      setTableReservationNames((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        try {
          localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next));
        } catch {}
        return next;
      });
      delete tableMapOrderIdByTableRef.current[key];
    },
    [selectedFloor]
  );

  const transferOccupiedTimestamp = useCallback(
    (
      fromId: string | number | null | undefined,
      toId: string | number | null | undefined,
      fallbackTimestamp?: number
    ) => {
      if (!toId) return;
      setTableOccupiedTimes((prev) => {
        const next = { ...prev };
        const toKey = String(toId);
        let timestamp =
          typeof fallbackTimestamp === 'number' && !Number.isNaN(fallbackTimestamp)
            ? fallbackTimestamp
            : undefined;
        if (fromId != null) {
          const fromKey = String(fromId);
          if (typeof next[fromKey] === 'number') {
            timestamp = next[fromKey];
          }
          delete next[fromKey];
        }
        if (typeof timestamp === 'number') {
          next[toKey] = timestamp;
        } else {
          delete next[toKey];
        }
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );
  // QSR/FSR 모드 구분 (초기 세팅에서 저장된 값)
  const [serviceMode] = useState<'QSR' | 'FSR'>(() => {
    try {
      const raw = localStorage.getItem('pos_setup_config');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.operationMode === 'QSR') return 'QSR';
      }
    } catch {}
    return 'FSR';
  });

  const [selectedChannelTab, setSelectedChannelTab] = useState<string>('table-map');
  const [channelVis, setChannelVis] = useState<{ togo: boolean; delivery: boolean }>(() => {
    try {
      const raw = localStorage.getItem('tableMapChannelVisibility');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          togo: parsed?.togo !== false,
          delivery: parsed?.delivery !== false,
        };
      }
    } catch {}
    return { togo: true, delivery: true };
  });
  const rightPanelVisible = channelVis.togo;
  /** Bistro(`/bistro`)는 투고 패널 토글과 무관하게 우측 탭 열 유지 */
  const effectiveRightPanelVisible = isBistroSalesRoute || rightPanelVisible;
  const [togoPanelSplitPreset, setTogoPanelSplitPreset] = useState<TableMapTogoPanelSplitPreset>(() =>
    readTableMapTogoPanelSplitFromStorage()
  );
  const [bistroTableMapLeftPct, setBistroTableMapLeftPct] = useState<number>(() =>
    readBistroTableMapLeftPercentFromStorage()
  );
  // 현재 시간 표시용 상태
  const [currentTime, setCurrentTime] = useState<string>(() => {
    const now = new Date();
    return formatHeaderClockLabel(now);
  });
  const [togoSearch, setTogoSearch] = useState<string>('');
  const [togoSort, setTogoSort] = useState<'time' | 'number'>('time');
  const [togoDir, setTogoDir] = useState<'asc' | 'desc'>('asc');
  const [togoStaleMinutes, setTogoStaleMinutes] = useState<number>(10);

  // Swipe-to-pickup state for order list cards
  const swipeDragRef = useRef<{ id: string; startX: number; currentX: number; type: string; cardWidth: number } | null>(null);
  const swipeDraggedRef = useRef<boolean>(false);
  /** 스와이프 픽업 직후 load*가 서버에 아직 PICKED_UP 반영 전인 행을 다시 넣는 것을 막기 위한 ID 집합 */
  const swipeRemovedPanelIdsRef = useRef<Set<string>>(new Set());
  /** fetchOrderList 시점에 최신 패널 행을 참조(Pickup List ↔ 투고패널 동기) */
  const togoOrdersPanelSyncRef = useRef<any[]>([]);
  const onlineQueueCardsPanelSyncRef = useRef<OnlineQueueCard[]>([]);
  /** 데이 클로징 등에서 항상 최신 fetchOrderList 호출용 */
  const fetchOrderListRef = useRef<((date: string, mode?: 'history' | 'pickup') => void) | null>(null);
  const [swipeDragState, setSwipeDragState] = useState<{ id: string; offsetX: number; dismissing?: boolean } | null>(null);
  const [softKbOpen, setSoftKbOpen] = useState(false);
  const [kbLang, setKbLang] = useState<string>('EN');
  const [refreshOrdersTrigger, setRefreshOrdersTrigger] = useState(0);

  const [bistroSessionOrders, setBistroSessionOrders] = useState<any[]>([]);
  const [bistroOrdersLoading, setBistroOrdersLoading] = useState(false);
  const [bistroContainerModalOpen, setBistroContainerModalOpen] = useState(false);
  const [bistroContainerModalId, setBistroContainerModalId] = useState('');
  const [bistroContainerTitle, setBistroContainerTitle] = useState('');
  const [bistroPendingTableElement, setBistroPendingTableElement] = useState<TableElement | null>(null);

  const loadBistroSessionOrders = useCallback(async () => {
    setBistroOrdersLoading(true);
    try {
      const list = await fetchOrdersForBistroSession();
      setBistroSessionOrders(list);
    } catch (e) {
      console.warn('[SalesPage/Bistro] orders load', e);
    } finally {
      setBistroOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isBistroSalesRoute) return;
    void loadBistroSessionOrders();
    const t = window.setInterval(() => void loadBistroSessionOrders(), 12000);
    return () => window.clearInterval(t);
  }, [isBistroSalesRoute, loadBistroSessionOrders]);

  useEffect(() => {
    if (!isBistroSalesRoute) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadBistroSessionOrders();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [isBistroSalesRoute, loadBistroSessionOrders]);

  // Reservation modal state
  const [showReservationModal, setShowReservationModal] = useState<boolean>(false);
  const [showWaitingModal, setShowWaitingModal] = useState<boolean>(false);
  const [selectedWaitingEntry, setSelectedWaitingEntry] = useState<any|null>(null);
  
  // Sold Out state (badge count only)
  const [soldOutItems, setSoldOutItems] = useState<Set<string>>(new Set());
  const [onlineOrderRestaurantId, setOnlineOrderRestaurantId] = useState<string | null>(
    localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id') || localStorage.getItem('firebase_restaurant_id')
  );

  // Online/Togo Order Detail Modal state (ê°œë³„ ì¹´ë“œ í´ë¦­ ì‹œ)
  const [showOrderDetailModal, setShowOrderDetailModal] = useState<boolean>(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any | null>(null);
  const [selectedOrderType, setSelectedOrderType] = useState<'online' | 'togo' | 'delivery' | null>(null);

  // Online/Togo ê²°ì œ ëª¨ë‹¬ state
  // Card detail modal state (individual card click)
  const [showCardDetailModal, setShowCardDetailModal] = useState<boolean>(false);
  const [cardDetailOrder, setCardDetailOrder] = useState<any | null>(null);
  const [cardDetailItems, setCardDetailItems] = useState<any[]>([]);
  const [cardDetailChannel, setCardDetailChannel] = useState<'online' | 'togo' | 'delivery' | null>(null);

  const [showOnlineTogoPaymentModal, setShowOnlineTogoPaymentModal] = useState<boolean>(false);
  const [onlineTogoPaymentOrder, setOnlineTogoPaymentOrder] = useState<any | null>(null);
  
  // Online/Togo ê²°ì œ ì„¸ì…˜ ê´€ë¦¬ (Dine-Inê³¼ ë™ì¼í•œ ë°©ì‹)
  const [onlineTogoSessionPayments, setOnlineTogoSessionPayments] = useState<Array<{ paymentId: number; method: string; amount: number; tip: number }>>([]);
  const onlineTogoSavedOrderIdRef = React.useRef<number | null>(null);

  // Online/Togo PaymentCompleteModal state
  const [showOnlineTogoPaymentCompleteModal, setShowOnlineTogoPaymentCompleteModal] = useState<boolean>(false);
  const [onlineTogoPaymentCompleteData, setOnlineTogoPaymentCompleteData] = useState<{ change: number; total: number; tip: number; payments: Array<{ method: string; amount: number }>; hasCashPayment: boolean; discount?: { percent: number; amount: number; originalSubtotal: number; discountedSubtotal: number; taxLines: Array<{ name: string; amount: number }>; taxesTotal: number } } | null>(null);
  const onlineTogoCompletionRef = React.useRef<any>(null);
  const [showOnlineTogoTipEntryModal, setShowOnlineTogoTipEntryModal] = useState<boolean>(false);
  const [onlineTogoPendingReceiptCountForTip, setOnlineTogoPendingReceiptCountForTip] = useState<number>(0);
  
  // UNPAID ì£¼ë¬¸ Pickup ì‹œë„ ì‹œ í™•ì¸ ëª¨ë‹¬
  const [showUnpaidPickupModal, setShowUnpaidPickupModal] = useState<boolean>(false);
  const [unpaidPickupOrder, setUnpaidPickupOrder] = useState<any | null>(null);
  
  // EXIT ëª¨ë‹¬ ìƒíƒœ
  const [showExitModal, setShowExitModal] = useState<boolean>(false);
  const [showBackofficePinModal, setShowBackofficePinModal] = useState<boolean>(false);
  const [backofficePinError, setBackofficePinError] = useState<string>('');
  const [backofficePinLoading, setBackofficePinLoading] = useState<boolean>(false);

  // Togo/Online Void Modal state
  const [showTogoVoidModal, setShowTogoVoidModal] = useState<boolean>(false);
  const [togoVoidOrder, setTogoVoidOrder] = useState<any | null>(null);
  const [togoVoidOrderType, setTogoVoidOrderType] = useState<string>('togo');
  const [togoVoidItems, setTogoVoidItems] = useState<any[]>([]);
  const [togoVoidSelections, setTogoVoidSelections] = useState<Record<string, { checked: boolean; qty: number }>>({});
  const [togoVoidPin, setTogoVoidPin] = useState<string>('');
  const [togoVoidPinError, setTogoVoidPinError] = useState<string>('');
  const [togoVoidReason, setTogoVoidReason] = useState<string>('');
  const [togoVoidReasonPreset, setTogoVoidReasonPreset] = useState<string>('');
  const [togoVoidNote, setTogoVoidNote] = useState<string>('');
  const [togoVoidLoading, setTogoVoidLoading] = useState<boolean>(false);

  // Clock In/Out modal state
  const [showClockInOutMenu, setShowClockInOutMenu] = useState<boolean>(false);
  const [showClockInModal, setShowClockInModal] = useState<boolean>(false);
  const [showClockOutModal, setShowClockOutModal] = useState<boolean>(false);
  const [isDayClosed, setIsDayClosed] = useState<boolean>(false);
  const [requiresOpening, setRequiresOpening] = useState<boolean>(false);

  // Day status check
  const checkDayStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/daily-closings/today`);
      const result = await response.json();
      if (result.success) {
        if (result.isOpen) {
          // 이미 영업 중 → Opening 모달 안 열림
          setIsDayClosed(false);
          setRequiresOpening(false);
          setShowOpeningModal(false);
        } else if (result.isClosed) {
          setIsDayClosed(true);
          setRequiresOpening(true);
          setShowOpeningModal(true);
        } else {
          // 오늘 레코드 없음 (첫 Opening 필요)
          setRequiresOpening(true);
          setShowOpeningModal(true);
        }
      }
    } catch (error) {
      console.error('Failed to check day status:', error);
    }
  }, []);

  useEffect(() => {
    checkDayStatus();
  }, [checkDayStatus]);

  // Opening/Closing modal state
  const [showOpeningModal, setShowOpeningModal] = useState<boolean>(false);
  const [showClosingModal, setShowClosingModal] = useState<boolean>(false);
  const [closingStep, setClosingStep] = useState<'report' | 'cash'>('report'); // 'report' = Z-Report ë³´ê¸°, 'cash' = í˜„ê¸ˆ ìž…ë ¥
  const [zReportData, setZReportData] = useState<any>(null);
  const [isLoadingZReport, setIsLoadingZReport] = useState<boolean>(false);

  
  // Cash denomination counts for Opening
  const [openingCashCounts, setOpeningCashCounts] = useState({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  
  // Cash denomination counts for Closing
  const [closingCashCounts, setClosingCashCounts] = useState({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  
  // Cash denomination definitions
  const cashDenominations = [
    { key: 'cent1', label: '1Â¢', value: 0.01 },
    { key: 'cent5', label: '5Â¢', value: 0.05 },
    { key: 'cent10', label: '10Â¢', value: 0.10 },
    { key: 'cent25', label: '25Â¢', value: 0.25 },
    { key: 'dollar1', label: '$1', value: 1 },
    { key: 'dollar2', label: '$2', value: 2 },
    { key: 'dollar5', label: '$5', value: 5 },
    { key: 'dollar10', label: '$10', value: 10 },
    { key: 'dollar20', label: '$20', value: 20 },
    { key: 'dollar50', label: '$50', value: 50 },
    { key: 'dollar100', label: '$100', value: 100 },
  ];
  
  // Calculate total from cash counts
  const calculateCashTotal = (counts: typeof openingCashCounts) => {
    return cashDenominations.reduce((sum, denom) => {
      return sum + (counts[denom.key as keyof typeof counts] * denom.value);
    }, 0);
  };
  
  const openingCashTotal = calculateCashTotal(openingCashCounts);
  const closingCashTotal = calculateCashTotal(closingCashCounts);
  
  // Reset cash counts
  const resetOpeningCashCounts = () => {
    setOpeningCashCounts({
      cent1: 0, cent5: 0, cent10: 0, cent25: 0,
      dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
    });
  };
  
  const resetClosingCashCounts = () => {
    setClosingCashCounts({
      cent1: 0, cent5: 0, cent10: 0, cent25: 0,
      dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
    });
  };
  
  // Currently focused denomination for number pad
  const [focusedOpeningDenom, setFocusedOpeningDenom] = useState<string>('dollar1');
  const [focusedClosingDenom, setFocusedClosingDenom] = useState<string>('dollar1');
  
  // Number pad handler for Opening
  const handleOpeningNumPad = (num: string) => {
    if (!focusedOpeningDenom) return;
    const currentValue = openingCashCounts[focusedOpeningDenom as keyof typeof openingCashCounts];
    let newValue: number;
    
    if (num === 'C') {
      newValue = 0;
    } else if (num === 'âŒ«') {
      newValue = Math.floor(currentValue / 10);
    } else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    
    setOpeningCashCounts(prev => ({ ...prev, [focusedOpeningDenom]: newValue }));
  };
  
  // Number pad handler for Closing
  const handleClosingNumPad = (num: string) => {
    if (!focusedClosingDenom) return;
    const currentValue = closingCashCounts[focusedClosingDenom as keyof typeof closingCashCounts];
    let newValue: number;
    
    if (num === 'C') {
      newValue = 0;
    } else if (num === 'âŒ«') {
      newValue = Math.floor(currentValue / 10);
    } else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    
    setClosingCashCounts(prev => ({ ...prev, [focusedClosingDenom]: newValue }));
  };
  
  const [clockError, setClockError] = useState<string>('');
  const [isClockLoading, setIsClockLoading] = useState<boolean>(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string; } | null>(null);
  const [earlyOutReason, setEarlyOutReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [showEarlyOutModal, setShowEarlyOutModal] = useState(false);

  // Gift Card States
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);
  const [giftCardMode, setGiftCardMode] = useState<'sell' | 'balance'>('sell');
  const [giftCardNumber, setGiftCardNumber] = useState(['', '', '', '']);
  const [giftCardAmount, setGiftCardAmount] = useState('');
  const [giftCardPaymentMethod, setGiftCardPaymentMethod] = useState<'Cash' | 'Visa' | 'MasterCard' | 'Other'>('Cash');
  const [giftCardCustomerName, setGiftCardCustomerName] = useState('');
  const [giftCardCustomerPhone, setGiftCardCustomerPhone] = useState('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardError, setGiftCardError] = useState('');
  const [giftCardInputFocus, setGiftCardInputFocus] = useState<'card' | 'amount' | 'pin'>('card');
  const [showGiftCardNameKeyboard, setShowGiftCardNameKeyboard] = useState(false);
  const [showGiftCardSoldPopup, setShowGiftCardSoldPopup] = useState(false);
  const [giftCardSellerPin, setGiftCardSellerPin] = useState('');
  const [giftCardIsReload, setGiftCardIsReload] = useState(false);
  const [giftCardExistingBalance, setGiftCardExistingBalance] = useState<number | null>(null);
  const [showGiftCardReloadPopup, setShowGiftCardReloadPopup] = useState(false);

  // Refund States
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundStep, setRefundStep] = useState<'list' | 'detail' | 'card_input' | 'giftcard_input' | 'confirm'>('list');
  const [refundPaidOrders, setRefundPaidOrders] = useState<any[]>([]);
  const [refundSelectedOrder, setRefundSelectedOrder] = useState<any | null>(null);
  const [refundOrderItems, setRefundOrderItems] = useState<any[]>([]);
  const [refundPayments, setRefundPayments] = useState<any[]>([]);
  const [refundSelectedItems, setRefundSelectedItems] = useState<{ [key: number]: number }>({});
  const [refundType, setRefundType] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [refundPin, setRefundPin] = useState('');
  const [refundPinError, setRefundPinError] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundCardNumber, setRefundCardNumber] = useState('');
  const [refundApprovalNumber, setRefundApprovalNumber] = useState('');
  const [refundGiftCardNumber, setRefundGiftCardNumber] = useState('');
  const [refundPendingData, setRefundPendingData] = useState<any>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundSearchDate, setRefundSearchDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const [refundSearchText, setRefundSearchText] = useState('');
  const [showRefundSuccessPopup, setShowRefundSuccessPopup] = useState(false);
  const [refundResult, setRefundResult] = useState<any | null>(null);
  const [showRefundCalendar, setShowRefundCalendar] = useState(false);
  const [refundCalendarMonth, setRefundCalendarMonth] = useState(new Date());
  const [refundTaxRate, setRefundTaxRate] = useState<number>(0);

  // Day Opening/Closing state
  // isDayClosed is already declared above with checkDayStatus

  // Move/Merge mode state (Restored from Backup)
  const [isMoveMergeMode, setIsMoveMergeMode] = useState<boolean>(false);
  const [isMergeInProgress, setIsMergeInProgress] = useState<boolean>(false); // ë”ë¸” í´ë¦­ ë°©ì§€
  const [sourceTableId, setSourceTableId] = useState<string | null>(null);
  const [sourceTogoOrder, setSourceTogoOrder] = useState<any | null>(null); // Togo → Togo ë¨¸ì§€ìš©
  const [sourceOnlineOrder, setSourceOnlineOrder] = useState<any | null>(null); // Online → Togo ë¨¸ì§€ìš©
  const [moveMergeStatus, setMoveMergeStatus] = useState<string>('');
  const [sourceSelectionInfo, setSourceSelectionInfo] = useState<{ tableId: string; label: string; orderId?: number | string | null } | null>(null);
  const [selectionChoice, setSelectionChoice] = useState<'ALL' | PartialSelectionPayload | null>(null);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [showMoveHistory, setShowMoveHistory] = useState(false);

  // Print Bill mode state
  const [isBillPrintMode, setIsBillPrintMode] = useState<boolean>(false);
  const [billPrintStatus, setBillPrintStatus] = useState<string>('');

  // Online Settings modal state (Prep Time, Pause, Day Off, Menu Hide, Utility tabs)
  const [showPrepTimeModal, setShowPrepTimeModal] = useState<boolean>(false);
  const [onlineModalTab, setOnlineModalTab] = useState<'preptime' | 'pause' | 'dayoff' | 'menuhide' | 'utility'>('preptime');
  
  // Menu Hide tab state
  const [menuHideCategories, setMenuHideCategories] = useState<Array<{
    category_id: string;
    name: string;
    item_count: number;
    hidden_online_count: number;
    hidden_delivery_count: number;
  }>>([]);
  const [menuHideItems, setMenuHideItems] = useState<Array<{
    item_id: string;
    name: string;
    price: number;
    online_visible: number;
    delivery_visible: number;
    online_hide_type: 'visible' | 'permanent' | 'time_limited';
    online_available_until: string | null;
    online_available_from: string | null;
    delivery_hide_type: 'visible' | 'permanent' | 'time_limited';
    delivery_available_until: string | null;
    delivery_available_from: string | null;
  }>>([]);
  const [menuHideSelectedCategory, setMenuHideSelectedCategory] = useState<string | null>(null);
  const [menuHideLoading, setMenuHideLoading] = useState<boolean>(false);
  const [menuHideSelectedItem, setMenuHideSelectedItem] = useState<string | null>(null);
  const [menuHideEditMode, setMenuHideEditMode] = useState<'online' | 'delivery' | null>(null);
  // Utility Settings (Bag Fee, Utensils) - Firebase 연동
  const [utilitySettings, setUtilitySettings] = useState<{
    bagFee: { enabled: boolean; amount: number };
    utensils: { enabled: boolean };
    preOrderReprint: { enabled: boolean };
  }>({
    bagFee: { enabled: false, amount: 0.10 },
    utensils: { enabled: false },
    preOrderReprint: { enabled: false },
  });
  const [savingUtility, setSavingUtility] = useState<boolean>(false);
  
  // Pause ì„¤ì • state (ê° ì±„ë„ë³„ pause ìƒíƒœì™€ ë‚¨ì€ ì‹œê°„)
  const [pauseSettings, setPauseSettings] = useState<{
    thezoneorder: { paused: boolean; pauseUntil: Date | null };
    ubereats: { paused: boolean; pauseUntil: Date | null };
    doordash: { paused: boolean; pauseUntil: Date | null };
    skipthedishes: { paused: boolean; pauseUntil: Date | null };
  }>({
    thezoneorder: { paused: false, pauseUntil: null },
    ubereats: { paused: false, pauseUntil: null },
    doordash: { paused: false, pauseUntil: null },
    skipthedishes: { paused: false, pauseUntil: null },
  });
  const [selectedPauseDuration, setSelectedPauseDuration] = useState<string | null>(null);
  
  const [prepTimeSettings, setPrepTimeSettings] = useState<{
    thezoneorder: { mode: 'auto' | 'manual'; time: string };
    ubereats: { mode: 'auto' | 'manual'; time: string };
    doordash: { mode: 'auto' | 'manual'; time: string };
    skipthedishes: { mode: 'auto' | 'manual'; time: string };
  }>(() => {
    // Load saved settings from localStorage on init
    const saved = localStorage.getItem('prepTimeSettings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse prepTimeSettings from localStorage');
      }
    }
    return {
      thezoneorder: { mode: 'auto', time: '15m' },
      ubereats: { mode: 'auto', time: '15m' },
      doordash: { mode: 'auto', time: '15m' },
      skipthedishes: { mode: 'auto', time: '15m' },
    };
  });
  const prepTimeSettingsRef = useRef(prepTimeSettings);
  useEffect(() => { prepTimeSettingsRef.current = prepTimeSettings; }, [prepTimeSettings]);

  // Day Off ì„¤ì • state
  const [dayOffDates, setDayOffDates] = useState<{ date: string; channels: string; type: string }[]>([]);
  const [dayOffCalendarMonth, setDayOffCalendarMonth] = useState<Date>(new Date());
  const [dayOffSelectedDates, setDayOffSelectedDates] = useState<string[]>([]);
  const [dayOffSelectedChannels, setDayOffSelectedChannels] = useState<string[]>(['all']);
  const [dayOffType, setDayOffType] = useState<'closed' | 'extended' | 'early' | 'late'>('closed');
  const [dayOffTime, setDayOffTime] = useState<{ start: string; end: string }>({ start: '09:00', end: '21:00' });
  const [dayOffSaveStatus, setDayOffSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ìƒˆ ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ ëª¨ë‹¬ ìƒíƒœ
  const [showNewOrderAlert, setShowNewOrderAlert] = useState<boolean>(false);
  const [newOrderAlertData, setNewOrderAlertData] = useState<any>(null);
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const previousOnlineOrdersRef = useRef<string[]>([]);
  const onlineAutoAcceptPrintOnceRef = useRef<Set<string>>(new Set());
  const isFirstOnlineOrderLoadRef = useRef<boolean>(true); // ì²« ë¡œë“œ ì‹œ ì•ŒëžŒ ë°©ì§€
  const isFirstDeliveryPanelLoadRef = useRef(true);
  const previousDeliveryPanelKeysRef = useRef<Set<string>>(new Set());

  // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ìŒ
  const onlineOrderAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio('/sounds/Online_Order.mp3');
    audio.preload = 'auto';
    onlineOrderAudioRef.current = audio;
    return () => {
      if (onlineOrderAudioRef.current) {
        onlineOrderAudioRef.current.pause();
        onlineOrderAudioRef.current = null;
      }
    };
  }, []);

  const playOnlineOrderSound = useCallback(() => {
    try {
      const audio = onlineOrderAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(err => console.error('Audio play failed:', err));
        console.log('Online order alarm played (MP3)');
      }
    } catch (error) {
      console.error('Audio playback error:', error);
    }
  }, []);

  // Order List modal state
  const [showOrderListModal, setShowOrderListModal] = useState<boolean>(false);
  const [orderListDate, setOrderListDate] = useState<string>(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const [orderListOrders, setOrderListOrders] = useState<any[]>([]);
  const [orderListSelectedOrder, setOrderListSelectedOrder] = useState<any | null>(null);
  const [orderListSelectedItems, setOrderListSelectedItems] = useState<any[]>([]);
  const [orderListVoidLines, setOrderListVoidLines] = useState<any[]>([]);
  const [showOrderListPaymentModal, setShowOrderListPaymentModal] = useState<boolean>(false);
  const [orderListPaymentOrder, setOrderListPaymentOrder] = useState<any | null>(null);
  const [orderListPaymentSessionPayments, setOrderListPaymentSessionPayments] = useState<Array<{ paymentId: number; method: string; amount: number; tip: number }>>([]);
  const [orderListLoading, setOrderListLoading] = useState<boolean>(false);
  const [showOrderListCalendar, setShowOrderListCalendar] = useState<boolean>(false);
  const [orderListCalendarMonth, setOrderListCalendarMonth] = useState<Date>(new Date());
  const [orderListTab, setOrderListTab] = useState<'history' | 'live'>('history');
  const [orderListOpenMode, setOrderListOpenMode] = useState<'history' | 'pickup'>('history');
  const [orderListChannelFilter, setOrderListChannelFilter] = useState<'all' | 'delivery'>('all');
  const [liveOrders, setLiveOrders] = useState<any[]>([]);
  const [liveOrderHighlightItem, setLiveOrderHighlightItem] = useState<string | null>(null);
  const [orderListTaxRate, setOrderListTaxRate] = useState<number>(0);
  const [orderListActiveTaxes, setOrderListActiveTaxes] = useState<Array<{ name: string; rate: number }>>([]);
  const [orderListTaxGroupMap, setOrderListTaxGroupMap] = useState<Record<number, Array<{ name: string; rate: number }>>>({});
  
  // Order List modal scroll refs
  const liveOrderCardRefs = useRef<{ [tableId: string]: HTMLDivElement | null }>({});
  const orderListScrollRef = useRef<HTMLDivElement>(null);
  const orderDetailScrollRef = useRef<HTMLDivElement>(null);

  const clearMoveMergeSelection = useCallback(() => {
    setSourceTableId(null);
    setSourceTogoOrder(null);
    setSourceOnlineOrder(null);
    setSourceSelectionInfo(null);
    setSelectionChoice(null);
    setIsSelectionModalOpen(false);
    setMoveMergeStatus('');
    setIsMergeInProgress(false); // ë”ë¸” í´ë¦­ ë°©ì§€ ìƒíƒœë„ ë¦¬ì…‹
  }, []);

  const beginSourceSelection = useCallback(async (element: TableElement, label: string) => {
    setSourceSelectionInfo({
      tableId: String(element.id),
      label,
      orderId: element.current_order_id || undefined,
    });
    if (element.current_order_id) {
      // ìŠ¤í”Œë¦¿ ì—¬ë¶€ í™•ì¸ - guest_numberê°€ 1ê°œë§Œ ìžˆìœ¼ë©´ ìŠ¤í”Œë¦¿ë˜ì§€ ì•Šì€ ê²ƒ
      try {
        const res = await fetch(`${API_URL}/orders/${element.current_order_id}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          const guestNumbers = new Set(data.items.map((item: any) => Number(item.guest_number) || 1));
          if (guestNumbers.size <= 1) {
            // ìŠ¤í”Œë¦¿ë˜ì§€ ì•ŠìŒ - ë°”ë¡œ ALL ì„ íƒ
            setSelectionChoice('ALL');
            setMoveMergeStatus(`âœ“ [Move All] ${label} → Select destination`);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to check split status:', e);
      }
      // ìŠ¤í”Œë¦¿ë¨ - ëª¨ë‹¬ í‘œì‹œ
      setSelectionChoice(null);
      setIsSelectionModalOpen(true);
      setMoveMergeStatus('Select guests/items to move.');
    } else {
      setSelectionChoice('ALL');
      setMoveMergeStatus('Select destination table');
    }
  }, []);

  useEffect(() => {
    if (!isMoveMergeMode) {
      clearMoveMergeSelection();
    }
  }, [isMoveMergeMode, clearMoveMergeSelection]);

  // Front-office default order setup (menu)
  const [defaultMenu, setDefaultMenu] = useState<{ menuId: number | null; menuName: string }>(() => {
    const saved = localStorage.getItem('foh_default_menu');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return { menuId: null, menuName: '' };
  });
  const [togoInfoTiming, setTogoInfoTiming] = useState<'before' | 'after'>(() => {
    const saved = localStorage.getItem('togo_info_timing');
    return saved === 'after' ? 'after' : 'before';
  });
  const menuCache = useMenuCache();
  const prefetchWorkerRef = useRef<Worker | null>(null);
  const idlePrefetchHandleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!defaultMenu.menuId) return;
    ensureOrderBootstrap(defaultMenu.menuId, 'pos').catch(err => {
      console.warn('Order bootstrap prefetch failed:', err);
    });
  }, [defaultMenu.menuId]);

  useEffect(() => {
    let cancelled = false;

    const applySelectServerSetting = (raw: any) => {
      if (cancelled) return;
      try {
        const nextValue = raw?.selectServerOnEntry;
        // ëª…ì‹œì ìœ¼ë¡œ trueì¸ ê²½ìš°ì—ë§Œ í™œì„±í™” (ê¸°ë³¸ê°’: false)
        setSelectServerPromptEnabled(nextValue === true);
      } catch (error) {
        console.warn('Failed to parse selectServerOnEntry flag:', error);
      }
    };

    const ensureLayoutSnapshot = async () => {
      if (typeof window === 'undefined') return;
      try {
        const existing = sessionStorage.getItem(LAYOUT_SETTINGS_SNAPSHOT_KEY);
        if (existing) {
          try {
            const parsed = JSON.parse(existing);
            if (parsed && typeof parsed === 'object') {
              applySelectServerSetting(parsed);
            }
          } catch (error) {
            console.warn('Failed to parse cached layout settings snapshot:', error);
          }
          return;
        }
        const res = await fetch(`${API_URL}/printers/layout-settings`, { cache: 'no-store' as RequestCache });
        if (!res.ok) return;
        const json = await res.json();
        const payload = (json && typeof json === 'object' && json.settings) ? json.settings : json;
        if (!payload || typeof payload !== 'object') return;
        if (cancelled) return;
        sessionStorage.setItem(LAYOUT_SETTINGS_SNAPSHOT_KEY, JSON.stringify(payload));
        applySelectServerSetting(payload);
      } catch (error) {
        console.warn('Failed to prefetch layout settings:', error);
      }
    };
    ensureLayoutSnapshot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const loadDefaultSetup = async () => {
      try {
        // 항상 서버에서 최신 POS 설정을 가져옴 (백엔드에서 변경된 경우 반영)
        const res = await fetch(`${API_URL}/order-page-setups/type/pos`);
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) {
          const { menuId, menuName } = rows[0];
          const newMenuId = Number(menuId);
          // 서버 설정이 현재와 다르면 업데이트
          if (newMenuId && newMenuId !== defaultMenu.menuId) {
            const payload = { menuId: newMenuId, menuName: String(menuName || '') };
            setDefaultMenu(payload);
            localStorage.setItem('foh_default_menu', JSON.stringify(payload));
            console.log('[SalesPage] Default menu updated from server:', payload);
          } else if (!defaultMenu.menuId && newMenuId) {
            const payload = { menuId: newMenuId, menuName: String(menuName || '') };
            setDefaultMenu(payload);
            localStorage.setItem('foh_default_menu', JSON.stringify(payload));
            console.log('[SalesPage] Default menu initialized from server:', payload);
          }
        }
      } catch (e) {
        // ignore; FOH can still navigate but OrderPage will show empty without menuId
      }
    };
    loadDefaultSetup();
  }, []);

  useEffect(() => {
    const loadTogoSetup = async () => {
      try {
        const res = await fetch(`${API_URL}/order-page-setups/type/togo`);
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) {
          const timing = rows[0].togoInfoTiming === 'after' ? 'after' : 'before';
          setTogoInfoTiming(timing);
          localStorage.setItem('togo_info_timing', timing);
        }
      } catch {}
    };
    loadTogoSetup();
  }, []);

  useEffect(() => {
    if (menuCache.isReady || menuCache.isLoading) return;

    let cancelled = false;

    const startPrefetch = async () => {
      if (cancelled || menuCache.isReady) return;
      try {
        const identifiers = await resolveMenuIdentifiers(API_URL);
        if (cancelled || menuCache.isReady) return;

        if (typeof Worker === 'function') {
          const worker = new Worker(new URL('../workers/menuPrefetchWorker.ts', import.meta.url));
          prefetchWorkerRef.current = worker;
          worker.onmessage = (event: MessageEvent<any>) => {
            const { type, payload, error } = event.data || {};
            if (type === 'prefetch:success' && payload && !cancelled) {
              menuCache.primeCache(payload);
            } else if (type === 'prefetch:error') {
              console.warn('Menu prefetch worker error:', error);
            }
            worker.terminate();
            prefetchWorkerRef.current = null;
          };
          worker.postMessage({
            type: 'prefetch',
            payload: {
              apiUrl: API_URL,
              storeId: identifiers.storeId,
              menuId: identifiers.menuId
            }
          });
        } else {
          const payload = await fetchMenuStructure(API_URL, identifiers.menuId, identifiers.storeId);
          if (!cancelled) {
            menuCache.primeCache(payload);
          }
        }
      } catch (error) {
        console.warn('Menu prefetch failed:', error);
      }
    };

    const schedulePrefetch = () => {
      if ('requestIdleCallback' in window) {
        idlePrefetchHandleRef.current = (window as any).requestIdleCallback(startPrefetch, { timeout: 500 });
      } else {
        const timeoutId = (window as any).setTimeout(startPrefetch, 80);
        idlePrefetchHandleRef.current = timeoutId as unknown as number;
      }
    };

    schedulePrefetch();

    return () => {
      cancelled = true;
      if (prefetchWorkerRef.current) {
        prefetchWorkerRef.current.terminate();
        prefetchWorkerRef.current = null;
      }
      if (idlePrefetchHandleRef.current !== null) {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idlePrefetchHandleRef.current);
        } else {
          clearTimeout(idlePrefetchHandleRef.current as unknown as number);
        }
        idlePrefetchHandleRef.current = null;
      }
    };
  }, [menuCache.isReady, menuCache.isLoading, menuCache.primeCache]);

  // localStorageì—ì„œ ì €ìž¥ëœ Floor ëª©ë¡ ë¶ˆëŸ¬ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
  const getSavedFloorList = () => {
    const savedFloorList = localStorage.getItem('tableMapFloorList');
    if (savedFloorList) {
      try {
        return JSON.parse(savedFloorList);
      } catch (error) {
        console.error('Error parsing saved floor list:', error);
        return ['1F', '2F', '3F', 'Patio'];
      }
    }
    return ['1F', '2F', '3F', 'Patio'];
  };

  // Floor ëª©ë¡ ì´ˆê¸°í™”
  useEffect(() => {
    const savedFloorList = getSavedFloorList();
    setFloorList(savedFloorList);
  }, []);

  // BO ìƒíƒœë³„ ìƒ‰ìƒ ë¡œë“œ
  useEffect(() => {
    try {
      const savedColors = localStorage.getItem(`tableMapFirstColors_${selectedFloor}`);
      if (savedColors) {
        const parsed = JSON.parse(savedColors);
        setFirstElementColors(parsed && typeof parsed === 'object' ? parsed : {});
      } else {
        setFirstElementColors({});
      }
    } catch {
      setFirstElementColors({});
    }
  }, [selectedFloor]);

  // screenSize ê°’ì´ ë³€ê²½ë  ë•Œë§ˆë‹¤ Consoleì— ì¶œë ¥
  useEffect(() => {
    console.log('ï¿½ï¿½ screenSize changed:', screenSize);
  }, [screenSize]);
  const [canvasStyle, setCanvasStyle] = useState<{ width?: string; height?: string; maxWidth?: string; maxHeight?: string }>({});
  // View mode ê³ ì •: í•­ìƒ Fixed(1:1 í”½ì…€)
  const viewMode: 'fixed' = 'fixed';
  const [scaleFactor, setScaleFactor] = useState<number>(1);
  const [actualScreenSize, setActualScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const pageHostRef = useRef<HTMLDivElement>(null);
  const fixedAreaRef = useRef<HTMLDivElement>(null);
  // BO Screen Sizeë¥¼ 'ì „ì²´ í”„ë ˆìž„' í¬ê¸°ë¡œ ê·¸ëŒ€ë¡œ ì‚¬ìš©
  // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ Screen Sizeë¥¼ ë™ì ìœ¼ë¡œ ì ìš©
  const frameWidthPx = parseInt(screenSize.width) || 1024;
  const frameHeightPx = parseInt(screenSize.height) || 768;
  const headerHeightPx = 56;
  // 16:9 와이드스크린(비율 ≥ 1.5)이면 하단바 30% 높게, 4:3은 기본 70px 유지
  const isWidescreen = (frameWidthPx / frameHeightPx) >= 1.5;
  // Footer UI scale: when using large BO frame (e.g. 1920x1080) on same physical screen,
  // text can look too small because global frame scaling often becomes 1.0.
  // We mimic the "natural" size feel of running 1024x768 (which usually scales up) by
  // selectively boosting footer only when the overall frame isn't already scaled up.
  const legacyReferenceScale = useMemo(() => {
    const w = actualScreenSize.width || window.innerWidth;
    const h = actualScreenSize.height || window.innerHeight;
    const scaleX = w / 1024;
    const scaleY = h / 768;
    return Math.max(0.5, Math.min(2.0, Math.min(scaleX, scaleY)));
  }, [actualScreenSize.width, actualScreenSize.height]);

  const footerUiScale = useMemo(() => {
    const isLargeFrame = frameWidthPx >= 1600 && frameHeightPx >= 900;
    const notShrunk = scaleFactor >= 0.98;
    if (!isLargeFrame || !notShrunk) return 1;
    return Math.min(1.45, Math.max(1, legacyReferenceScale));
  }, [frameWidthPx, frameHeightPx, scaleFactor, legacyReferenceScale]);

  const footerButtonFontPx = useMemo(() => {
    const px = 16 * footerUiScale;
    return Math.round(Math.max(14, Math.min(24, px)));
  }, [footerUiScale]);

  const footerGapPx = useMemo(() => {
    const px = 14 * Math.min(1.2, footerUiScale);
    return Math.round(Math.max(10, Math.min(22, px)));
  }, [footerUiScale]);

  const footerHeightPx = Math.round((isWidescreen ? 91 : 70) * footerUiScale);
  const contentHeightPx = Math.max(0, frameHeightPx - headerHeightPx - footerHeightPx);
  // 좌(테이블맵)/우(투고 패널) 비율 — Order Screen Setup / Manager 에서 설정
  const togoPanelLeftPct = isBistroSalesRoute
    ? bistroTableMapLeftPct
    : leftPercentFromSplitPreset(togoPanelSplitPreset);
  const leftWidthPx = effectiveRightPanelVisible ? Math.round(frameWidthPx * (togoPanelLeftPct / 100)) : frameWidthPx;
  const rightWidthPx = effectiveRightPanelVisible ? Math.max(0, frameWidthPx - leftWidthPx) : 0;
  /** 기준 34% 우측 대비 현재 우측 비율로 상단 버튼·카드 밀도 */
  const togoPanelUiScale = isBistroSalesRoute
    ? bistroPanelUiScaleFromLeftPct(effectiveRightPanelVisible, bistroTableMapLeftPct)
    : togoPanelUiScaleFromPresets(effectiveRightPanelVisible, togoPanelSplitPreset);

  const bistroElementIdSet = useMemo(() => {
    const set = new Set<string>();
    tableElements.forEach((e: any) => {
      if (e?.id != null) set.add(String(e.id));
    });
    return set;
  }, [tableElements]);

  const bistroTableStatusById = useMemo(() => {
    const m: Record<string, string> = {};
    tableElements.forEach((e: any) => {
      if (e?.id != null) m[String(e.id)] = String(e.status || 'Available');
    });
    return m;
  }, [tableElements]);

  const bistroPanelOrders = useMemo(
    () => filterOrdersForBistroPanel(bistroSessionOrders, bistroElementIdSet),
    [bistroSessionOrders, bistroElementIdSet]
  );

  const bistroContainerModalOrders = useMemo(
    () => filterOrdersForContainer(bistroSessionOrders, bistroContainerModalId),
    [bistroSessionOrders, bistroContainerModalId]
  );
  const togoTopBtnMinH = Math.max(40, Math.round(48 * togoPanelUiScale));
  const togoBtnFontPx = Math.max(11, Math.round(footerButtonFontPx * togoPanelUiScale));
  /** 우측 패널 Delivery / Togo / Online 주문 카드: 최소 높이(56×1.25×0.9×0.95 내림, 하한 56px) */
  const togoPanelOrderCardMinHeightPx = Math.max(56, Math.floor(56 * 1.25 * 0.9 * 0.95));
  const togoPanelCardLine1Px = Math.max(13, Math.round(11 * 1.33));
  const togoPanelCardLine2Px = Math.max(12, Math.round(10 * 1.38));
  /** READY/UNPAID — 크기 유지(채널명·시각만 소폭 축소) */
  const togoPanelCardBadgePx = Math.max(8, Math.round(7 * 1.22));
  /** 1행 채널명(TOGO, WEB, UBER, DDASH, SKIP …) */
  const togoPanelCardChannelPx = Math.max(12, Math.round(togoPanelCardLine1Px * 0.91));
  /** 1행 우측 POS 일일 번호(#nnn) */
  const togoPanelCardLine1PosNumberPx = Math.max(12, Math.round(togoPanelCardLine1Px * 0.91));
  /** 2행 시각 숫자부(AM/PM 글자 크기는 renderTogoPanelTimeAmPm의 merPx 그대로) */
  const togoPanelCardPickupClockPx = Math.max(11, Math.round(togoPanelCardLine1Px * 0.9));
  /** 둘째 줄 서버 칩 */
  const togoPanelCardServerChipPx = Math.max(7, Math.round(togoPanelCardLine2Px * 0.68 * 0.91));
  /** 2행 우측 채널 주문번호·전화 4자리 등 */
  const togoPanelCardChannelOrderPx = Math.max(10, Math.round(togoPanelCardLine1Px * 0.9));
  /** 2행 기본(시간 영역 보조) — 아주 약간만 축소 */
  const togoPanelCardLine2RowPx = Math.max(11, Math.round(togoPanelCardLine2Px * 0.93));
  // ìš”ì†ŒëŠ” BO ì¢Œí‘œ/í¬ê¸°ë¥¼ ê·¸ëŒ€ë¡œ ì‚¬ìš©(ìŠ¤ì¼€ì¼ ì—†ìŒ)
  // BO TableMapManagerPageì™€ ì¢Œí‘œ ì¼ì¹˜ë¥¼ ìœ„í•œ ìŠ¤ì¼€ì¼ ê³„ì‚°
  // BOì—ì„œ í…Œì´ë¸”ë§µ ì˜ì—­ ë†’ì´: ìº”ë²„ìŠ¤ ë†’ì´ì˜ 93% (ìƒë‹¨ 7% í—¤ë” ì œì™¸)
  const boMapHeight = Math.max(0, frameHeightPx - 56 - 70);
  const boMapWidth = frameWidthPx * 0.75;
  const elementScaleX = leftWidthPx / boMapWidth;
  const elementScaleY = contentHeightPx / boMapHeight;
  const elementScale = Math.min(elementScaleX, elementScaleY);
  const KEYBOARD_RESERVED_HEIGHT = 260;
  const DELIVERY_KEYBOARD_RESERVED_HEIGHT = 360;
  const TOGO_MODAL_MAX_WIDTH = 900;
  const togoModalMaxHeight = Math.max(360, frameHeightPx - KEYBOARD_RESERVED_HEIGHT - 32);
  const togoModalMaxWidth = Math.min(frameWidthPx - 48, TOGO_MODAL_MAX_WIDTH);
  const keyboardMaxWidth = Math.min(frameWidthPx - 120, 860);

  // ì‹¤ì œ í™”ë©´ í¬ê¸° ê°ì§€ ë° ìŠ¤ì¼€ì¼ ê³„ì‚°
  useEffect(() => {
    const updateScreenSize = () => {
      setActualScreenSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    // ì´ˆê¸° í¬ê¸° ì„¤ì •
    updateScreenSize();

    // ë¦¬ì‚¬ì´ì¦ˆ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  // 현재 시간 업데이트 (1초마다)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(formatHeaderClockLabel(now));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ë°±ì˜¤í”¼ìŠ¤ í•´ìƒë„ì™€ ì‹¤ì œ í™”ë©´ í¬ê¸°ë¥¼ ë¹„êµí•˜ì—¬ ìŠ¤ì¼€ì¼ ê³„ì‚°
  useEffect(() => {
    const actualWidth = actualScreenSize.width;
    const actualHeight = actualScreenSize.height;
    
    // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í•´ìƒë„
    const boWidth = frameWidthPx;
    const boHeight = frameHeightPx;
    
    // ë„ˆë¹„ì™€ ë†’ì´ ë¹„ìœ¨ ê³„ì‚°
    const scaleX = actualWidth / boWidth;
    const scaleY = actualHeight / boHeight;
    
    // ë” ìž‘ì€ ë¹„ìœ¨ì„ ì‚¬ìš©í•˜ì—¬ í™”ë©´ì— ë§žì¶¤ (ë¹„ìœ¨ ìœ ì§€)
    // ìµœì†Œ 0.5ë°°, ìµœëŒ€ 2ë°°ë¡œ ì œí•œ
    const calculatedScale = Math.max(0.5, Math.min(2.0, Math.min(scaleX, scaleY)));
    
    setScaleFactor(calculatedScale);
    console.log(`[SalesPage] Screen scaling: BO=${boWidth}x${boHeight}, Actual=${actualWidth}x${actualHeight}, Scale=${calculatedScale.toFixed(2)}`);
  }, [frameWidthPx, frameHeightPx, actualScreenSize]);

  // Togo ì£¼ë¬¸ ê´€ë ¨ ìƒíƒœë“¤
  const [showTogoOrderModal, setShowTogoOrderModal] = useState(false);
  const [showFsrPickupModal, setShowFsrPickupModal] = useState(false);
  const [pickupModalInitialMode, setPickupModalInitialMode] = useState<'togo' | 'delivery' | 'online'>('togo');
  const [showPickupListModal, setShowPickupListModal] = useState(false);
  const [fsrTogoButtonVisible, setFsrTogoButtonVisible] = useState<boolean>(() => {
    try { return localStorage.getItem('fsrTogoButtonVisible') !== 'false'; } catch { return true; }
  });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [pickupTime, setPickupTime] = useState(15);
  const [togoReadyHour, setTogoReadyHour] = useState<string>('');
  const [togoReadyMinute, setTogoReadyMinute] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const customerPhoneRef = useRef(''); // ë¹„ë™ê¸° í´ë¡œì €ìš© ref
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerZip, setCustomerZip] = useState('');
  const [togoOrderMode, setTogoOrderMode] = useState<'togo' | 'delivery'>('togo');
  
  // Delivery ì „ìš© ëª¨ë‹¬ state
  const [showDeliveryOrderModal, setShowDeliveryOrderModal] = useState(false);
  const [deliveryCompany, setDeliveryCompany] = useState<'UberEats' | 'Doordash' | 'SkipTheDishes' | 'Fantuan' | ''>('');
  const [deliveryOrderNumber, setDeliveryOrderNumber] = useState('');
  const [deliveryPrepTime, setDeliveryPrepTime] = useState(15);
  const [deliveryReadyHour, setDeliveryReadyHour] = useState<string>('');
  const [deliveryReadyMinute, setDeliveryReadyMinute] = useState<string>('');
  const deliveryOrderInputRef = useRef<HTMLInputElement>(null);
  
  type TimePickerTarget = 'TOGO_HOUR' | 'TOGO_MINUTE' | 'DELIVERY_HOUR' | 'DELIVERY_MINUTE';
  const [timePickerTarget, setTimePickerTarget] = useState<TimePickerTarget | null>(null);
  const openTimePicker = (target: TimePickerTarget) => setTimePickerTarget(target);
  const closeTimePicker = () => setTimePickerTarget(null);

  const [prepButtonsLocked, setPrepButtonsLocked] = useState(false);
  const [togoNote, setTogoNote] = useState('');
  const [pickupAmPm, setPickupAmPm] = useState<'AM' | 'PM'>(() => getCurrentAmPm());
  const [pickupDateLabel, setPickupDateLabel] = useState(() => formatPickupDateLabel());
  const [showServerSelectionModal, setShowServerSelectionModal] = useState(false);
  const [serverModalLoading, setServerModalLoading] = useState(false);
  const [serverModalError, setServerModalError] = useState('');
  const [clockedInServers, setClockedInServers] = useState<ClockedInEmployee[]>([]);
  const [selectedTogoServer, setSelectedTogoServer] = useState<ClockedInEmployee | null>(null);
  /** 서버선택모드일 때 테이블맵 상단 배지용 (Order/TOGO에서 저장한 세션 키 + TOGO 선택) */
  const [tableMapHeaderServerName, setTableMapHeaderServerName] = useState<string | null>(null);
  const [togoOrderMeta, setTogoOrderMeta] = useState<Record<string, VirtualOrderMeta>>({});
  const [selectServerPromptEnabled, setSelectServerPromptEnabled] = useState(false);
  const shouldPromptServerSelection = selectServerPromptEnabled !== false;
  const [selectedHistoryOrderId, setSelectedHistoryOrderId] = useState<number | null>(null);
  const [historyDetailsMap, setHistoryDetailsMap] = useState<Record<number, HistoryOrderDetailPayload>>({});
  const [historyOrderDetail, setHistoryOrderDetail] = useState<HistoryOrderDetailPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const syncTableMapHeaderServer = useCallback(() => {
    if (!shouldPromptServerSelection) {
      setTableMapHeaderServerName(null);
      return;
    }
    try {
      const stored = loadServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID);
      const fromTogo = selectedTogoServer?.employee_name?.trim();
      const name =
        (stored?.serverName && String(stored.serverName).trim()) || fromTogo || null;
      setTableMapHeaderServerName(name);
    } catch {
      setTableMapHeaderServerName(selectedTogoServer?.employee_name?.trim() || null);
    }
  }, [shouldPromptServerSelection, selectedTogoServer]);

  useEffect(() => {
    syncTableMapHeaderServer();
  }, [syncTableMapHeaderServer]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') syncTableMapHeaderServer();
    };
    const onPos = () => syncTableMapHeaderServer();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onPos);
    window.addEventListener('posServerAssignmentUpdated', onPos);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onPos);
      window.removeEventListener('posServerAssignmentUpdated', onPos);
    };
  }, [syncTableMapHeaderServer]);

  /** 테이블맵 타일: 테이블마다 OrderPage가 저장한 serverAssignment:table:{elementId} 재조회용 */
  const [serverTableAssignmentTick, setServerTableAssignmentTick] = useState(0);

  const tableServerLabelByElementId = useMemo(() => {
    if (!shouldPromptServerSelection) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const el of tableElements) {
      const typ = String(el.type || '');
      if (!['rounded-rectangle', 'circle', 'bar', 'room'].includes(typ)) continue;
      const id = String(el.id);
      const fromOrder = (el as TableElement).order_server_name;
      const orderName = fromOrder && String(fromOrder).trim();
      if (orderName) {
        out[id] = orderName;
        continue;
      }
      const a = loadServerAssignment('table', id);
      const name = a?.serverName && String(a.serverName).trim();
      if (name) out[id] = name;
    }
    return out;
  }, [shouldPromptServerSelection, tableElements, serverTableAssignmentTick]);

  useEffect(() => {
    const bump = () => setServerTableAssignmentTick((x) => x + 1);
    window.addEventListener('posServerAssignmentUpdated', bump);
    return () => window.removeEventListener('posServerAssignmentUpdated', bump);
  }, []);

  // ì˜¤ëŠ˜ì˜ ì˜ˆì•½ í˜„í™© ìƒíƒœ
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  const togoTodayReservationsScrollRef = useRef<HTMLDivElement | null>(null);
  const [togoTodayResScrollTick, setTogoTodayResScrollTick] = useState(0);

  const loadTodayReservations = useCallback(async () => {
    try {
      const today = getLocalDateString();
      const res = await fetch(`${API_URL}/reservations?date=${today}`);
      if (!res.ok) return;
      const data = await res.json();
      const reservations = Array.isArray(data) ? data : (data.reservations || []);
      reservations.sort((a: any, b: any) => {
        const timeA = a.reservation_time || a.time || '';
        const timeB = b.reservation_time || b.time || '';
        return timeA.localeCompare(timeB);
      });
      setTodayReservations(reservations);
    } catch (err) {
      console.error('Failed to load reservations:', err);
    }
  }, []);

  useEffect(() => {
    loadTodayReservations();
    const checkScheduledUpdate = () => {
      const now = new Date();
      if (now.getHours() === 14 && now.getMinutes() === 0) {
        loadTodayReservations();
      }
    };
    const interval = setInterval(checkScheduledUpdate, 60000);
    return () => clearInterval(interval);
  }, [loadTodayReservations]);

  useEffect(() => {
    if (todayReservations.length <= 4) return;
    const id = window.setInterval(() => void setTogoTodayResScrollTick(t => t + 1), 60000);
    return () => window.clearInterval(id);
  }, [todayReservations.length]);

  useLayoutEffect(() => {
    const container = togoTodayReservationsScrollRef.current;
    if (!container) return;
    if (todayReservations.length <= 4) {
      container.scrollTop = 0;
      return;
    }
    const todayStr = getLocalDateString();
    const idx = getTogoTodayReservationScrollToIndex(todayReservations, todayStr);
    if (idx === 0) {
      container.scrollTop = 0;
      return;
    }
    if (idx >= todayReservations.length) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    const el = container.querySelector(`[data-togo-residx="${idx}"]`) as HTMLElement | null;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    const nextTop = container.scrollTop + (elRect.top - contRect.top);
    container.scrollTop = Math.max(0, nextTop);
  }, [todayReservations, togoTodayResScrollTick]);
  // ============================================
  // 온라인 예약 Accept/Reject 시스템
  // ============================================
  const [pendingOnlineReservation, setPendingOnlineReservation] = useState<any | null>(null);
  const [showOnlineReservationPopup, setShowOnlineReservationPopup] = useState(false);
  const [onlineReservationProcessing, setOnlineReservationProcessing] = useState(false);
  const processedOnlineReservationIds = React.useRef<Set<string>>(new Set());

  // Firebase 실시간 리스너: 새 온라인 예약 pending 감지
  useEffect(() => {
    const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
    if (!restaurantId) return;

    const q = query(
      collection(firebaseDb, 'restaurants', restaurantId, 'reservations'),
      where('status', '==', 'pending'),
      where('channel', '==', 'ONLINE')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pending: any[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        pending.push({
          firebase_doc_id: docSnap.id,
          reservation_number: data.reservation_number || '',
          customer_name: data.customer_name || '',
          phone_number: data.phone_number || '',
          customer_email: data.customer_email || '',
          reservation_date: data.reservation_date || '',
          reservation_time: data.reservation_time || '',
          party_size: data.party_size || 2,
          tables_needed: data.tables_needed || 1,
          deposit_amount: data.deposit_amount || 0,
          special_requests: data.special_requests || '',
          created_at: data.created_at || '',
        });
      });

      if (pending.length > 0) {
        // Sort newest first
        pending.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        // Find first not yet processed
        const newReservation = pending.find(
          (r: any) => !processedOnlineReservationIds.current.has(r.firebase_doc_id)
        );
        if (newReservation && !showOnlineReservationPopup) {
          setPendingOnlineReservation(newReservation);
          setShowOnlineReservationPopup(true);
          // Play notification sound
          try {
            const audio = new Audio('/sounds/Online_Order.mp3');
            audio.volume = 1.0;
            audio.play().catch(() => {});
          } catch {}
        }
      }
    }, (error) => {
      console.warn('[Reservation Listener] Firebase error:', error);
    });

    return () => unsubscribe();
  }, [showOnlineReservationPopup]);

  const handleAcceptOnlineReservation = async () => {
    if (!pendingOnlineReservation || onlineReservationProcessing) return;
    setOnlineReservationProcessing(true);
    try {
      const res = await fetch(`${API_URL}/reservations/accept-online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingOnlineReservation),
      });
      const data = await res.json();
      if (data.success) {
        processedOnlineReservationIds.current.add(pendingOnlineReservation.firebase_doc_id);
        setShowOnlineReservationPopup(false);
        setPendingOnlineReservation(null);
        await loadTodayReservations();
        // Reload table map to show reserved status
        if (data.assignedTable) {
          window.location.reload();
        }
      } else {
        alert('Failed to accept reservation: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error accepting reservation: ' + err.message);
    } finally {
      setOnlineReservationProcessing(false);
    }
  };

  const handleRejectOnlineReservation = async () => {
    if (!pendingOnlineReservation || onlineReservationProcessing) return;
    setOnlineReservationProcessing(true);
    try {
      const res = await fetch(`${API_URL}/reservations/reject-online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebase_doc_id: pendingOnlineReservation.firebase_doc_id,
          reservation_number: pendingOnlineReservation.reservation_number,
        }),
      });
      const data = await res.json();
      if (data.success) {
        processedOnlineReservationIds.current.add(pendingOnlineReservation.firebase_doc_id);
        setShowOnlineReservationPopup(false);
        setPendingOnlineReservation(null);
      } else {
        alert('Failed to reject reservation: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error rejecting reservation: ' + err.message);
    } finally {
      setOnlineReservationProcessing(false);
    }
  };

  const [historyError, setHistoryError] = useState('');
  const [customerHistoryOrders, setCustomerHistoryOrders] = useState<any[]>([]);
  const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);
  const [customerHistoryError, setCustomerHistoryError] = useState('');
  const [togoKeyboardTarget, setTogoKeyboardTarget] = useState<'phone' | 'name' | 'address' | 'note' | 'zip'>('phone');
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customerSuggestionSource, setCustomerSuggestionSource] = useState<'phone' | 'name' | null>(null);
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<CustomerSuggestion | null>(null);
  const [reorderLoading, setReorderLoading] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('glass-pulse-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'glass-pulse-style';
    styleEl.innerHTML = `
      @keyframes glassPulse {
        0% {
          box-shadow: 0 10px 25px rgba(95, 0, 255, 0.2);
          border-color: rgba(255,255,255,0.45);
        }
        50% {
          box-shadow: 0 16px 32px rgba(95, 0, 255, 0.45);
          border-color: rgba(255,255,255,0.9);
        }
        100% {
          box-shadow: 0 10px 25px rgba(95, 0, 255, 0.2);
          border-color: rgba(255,255,255,0.45);
        }
      }
      @keyframes beamSweep {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }
    `;
    document.head.appendChild(styleEl);
  }, []);
  const suggestionHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerSuggestionFetchIdRef = useRef(0);
  const historyFetchIdRef = useRef(0);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLTextAreaElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const formatEmployeeName = (fullName: string) => {
    const trimmed = (fullName || '').trim();
    if (!trimmed) return '';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0] || '';
    return lastInitial ? `${first} ${lastInitial.toUpperCase()}` : first;
  };
  const formatCurrency = (value?: number | string | null) => {
    const num = Number(value || 0);
    return `$${num.toFixed(2)}`;
  };
  const normalizeOrderId = (value: any): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const formatHistoryTimestamp = (input?: string | null) => {
    if (!input) return '';
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const buildOrderItemPreview = (items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return 'No items';
    const preview = items
      .slice(0, 3)
      .map((it: any) => `${it.quantity || 1}x ${it.name}`)
      .join(', ');
    return items.length > 3 ? `${preview} + ${items.length - 3} more` : preview;
  };
  const normalizePhoneDigits = (value: string) => (value || '').replace(/\D/g, '');
  const getTogoPhoneDigits = (input: string) => normalizePhoneDigits(input).slice(0, 11);
  const formatTogoPhone = (input: string) => {
    const digits = getTogoPhoneDigits(input);
    if (!digits) return '';
    
    // 3ìžë¦¬ ì´í•˜ì¼ ë•ŒëŠ” ê´„í˜¸ ì—†ì´ ìˆ«ìžë§Œ í‘œì‹œ (ì§€ìš°ê¸° íŽ¸í•˜ê²Œ)
    if (digits.length <= 3) return digits;

    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    let formatted = `(${area}) `; // 4ìžë¦¬ ì´ìƒì¼ ë•Œ ê´„í˜¸ì™€ ê³µë°± ì¶”ê°€

    if (!rest) return formatted.trim(); // í˜¹ì‹œ ëª¨ë¥¼ ë°©ì–´
    
    // 4ë²ˆì§¸ ìžë¦¬ë¶€í„°ëŠ” (123) 4... í˜•ì‹
    if (rest.length <= 3) return `${formatted}${rest}`;

    const middleLength = digits.length > 10 ? 4 : 3;
    const middle = rest.slice(0, middleLength);
    const remaining = rest.slice(middleLength);
    const hyphenSection = remaining ? `-${remaining}` : '';

    return `${formatted}${middle}${hyphenSection}`;
  };
  const getOrderTimestamp = useCallback((order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time ||
      '';
    const date = new Date(source);
    const fallback = Number(order?.id) || Date.now();
    return Number.isNaN(date.getTime()) ? fallback : date.getTime();
  }, []);

  const abbreviateDeliveryChannel = (company?: string | null): string => {
    if (!company) return 'DLV';
    const lower = company.trim().toLowerCase();
    if (lower.includes('ubereats') || lower === 'uber' || lower.includes('uber eats')) return 'UBER';
    if (lower.includes('doordash') || lower === 'ddash') return 'DDASH';
    if (lower.includes('skip') || lower.includes('skipthedishes')) return 'SKIP';
    if (lower.includes('fantuan')) return 'FTUAN';
    if (lower.includes('grubhub')) return 'GRUB';
    return company.length > 6 ? company.slice(0, 6).toUpperCase() : company.toUpperCase();
  };

  /**
   * 들어온 온라인/딜리버리 주문(Firestore 포맷)에 대해 prepTimeSettings의 어느 채널 키를 쓸지 결정.
   * Urban Piper 등 채널 슬러그가 식별 안 되면 thezoneorder로 폴백.
   */
  const getChannelKeyForOnlineOrder = (
    order: any
  ): 'thezoneorder' | 'ubereats' | 'doordash' | 'skipthedishes' => {
    const company = String(order?.deliveryCompany || order?.delivery_company || '')
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
    if (company === 'UBEREATS' || company === 'UBER') return 'ubereats';
    if (company === 'DOORDASH') return 'doordash';
    if (company === 'SKIPTHEDISHES' || company === 'SKIP') return 'skipthedishes';
    return 'thezoneorder';
  };

  /**
   * 채널별 prepTimeSettings에서 (mode, time, prepMinutes)을 안전하게 뽑는다.
   * Urban Piper 테스트 등 미식별 채널은 thezoneorder 설정을 따른다.
   */
  const resolveOnlineOrderPrepConfig = (order: any): {
    channelKey: 'thezoneorder' | 'ubereats' | 'doordash' | 'skipthedishes';
    mode: 'auto' | 'manual';
    time: string;
    prepMinutes: number;
  } => {
    const channelKey = getChannelKeyForOnlineOrder(order);
    const settings = prepTimeSettingsRef.current as any;
    const cfg = settings?.[channelKey] || settings?.thezoneorder || { mode: 'manual', time: '20m' };
    const time = String(cfg.time || '20m');
    const prepMinutes = parseInt(time.replace(/[^\d]/g, ''), 10) || 20;
    const mode = cfg.mode === 'auto' ? 'auto' : 'manual';
    return { channelKey, mode, time, prepMinutes };
  };

  const formatChannelOrderNumber = (orderNum?: string | number | null, phone?: string | null): string => {
    const raw = String(orderNum || '').trim();
    if (raw && raw !== '0' && raw !== 'undefined' && raw !== 'null') {
      return raw.length > 8 ? raw.slice(-8) : raw;
    }
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length >= 4) {
      return digits.length > 8 ? digits.slice(-8) : digits;
    }
    return '—';
  };

  /** 딜리버리 패널: 플랫폼·외부 주문번호 — 7자 초과 시 문자열 끝(뒷자리)부터 7글자만 표시 (`slice(-7)`) */
  const formatDeliveryOrderNumberForPanel = (orderNum?: string | number | null): string => {
    const raw = String(orderNum ?? '').trim();
    if (!raw || raw === '0' || raw === 'undefined' || raw === 'null') return '—';
    const lastN = 7;
    return raw.length > lastN ? raw.slice(-lastN) : raw;
  };

  /** Online row (Togo panel): TZO-MMDDYY-XXXX → TZO-XXXX, fallback: phone last 4, POS order # */
  const formatOnlinePanelDisplayId = (
    onlineOrderNum?: string | number | null,
    phone?: string | null,
    posOrderNum?: string | number | null
  ): string => {
    const raw = String(onlineOrderNum ?? '').trim();
    if (raw && raw !== '0' && raw !== 'undefined' && raw !== 'null') {
      const tzoMatch = raw.match(/^(TZO)-?\d{6}-?(\d{4})$/i);
      if (tzoMatch) return `TZ-${tzoMatch[2]}`;
      return raw.length > 8 ? raw.slice(-8) : raw;
    }
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length >= 4) {
      return `TZ-${digits.slice(-4)}`;
    }
    const num = Number(posOrderNum);
    if (Number.isFinite(num) && num > 0) {
      return `#${String(num).padStart(3, '0')}`;
    }
    return '—';
  };

  /** 투고 패널 온라인 카드 2행 우측: 고객 전화 끝 최대 4자리, 없으면 POS 일일 주문번호 */
  const formatOnlineQueueCardSecondLineRight = (
    phone?: string | null,
    posOrderNum?: string | number | null
  ): string => {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length > 0) {
      return digits.length > 4 ? digits.slice(-4) : digits;
    }
    const rawPos = String(posOrderNum ?? '').trim();
    const numFromPos = Number(rawPos);
    if (Number.isFinite(numFromPos) && numFromPos > 0) {
      return `#${String(numFromPos).padStart(3, '0')}`;
    }
    return '—';
  };

  const formatTogoPanelDisplayId = (
    phone?: string | null,
    name?: string | null,
    posOrderNum?: string | number | null
  ): string => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length > 0) {
      return digits.length > 4 ? digits.slice(-4) : digits;
    }
    const trimmedName = (name || '').trim();
    if (trimmedName) {
      return trimmedName.length > 8 ? trimmedName.slice(0, 8) : trimmedName;
    }
    const num = Number(posOrderNum);
    if (Number.isFinite(num) && num > 0) {
      return `#${String(num).padStart(3, '0')}`;
    }
    return '—';
  };

  const formatTimeAmPm = (t?: string | null): string => {
    if (t == null) return '';
    let raw = String(t).trim();
    if (!raw) return '';

    // ISO / "YYYY-MM-DD HH:mm:ss" 등 → 로컬 시:분으로 정규화 후 아래 24h 분기로 처리
    if (raw.length >= 10 && (raw.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(raw))) {
      const d = new Date(raw.replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) {
        raw = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }

    if (raw.includes('오전') || raw.includes('오후')) {
      const isPM = raw.includes('오후');
      const timeOnly = raw.replace(/오전|오후/g, '').trim();
      return `${timeOnly} ${isPM ? 'PM' : 'AM'}`;
    }

    const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const min = m12[2];
      const isPM = m12[3].toUpperCase() === 'PM';
      if (isPM && h < 12) h += 12;
      if (!isPM && h === 12) h = 0;
      raw = `${String(h).padStart(2, '0')}:${min}`;
    }

    const m24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m24) {
      let h = parseInt(m24[1], 10);
      const min = m24[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      if (h > 12) h -= 12;
      if (h === 0) h = 12;
      return `${h}:${min} ${ampm}`;
    }
    return raw;
  };

  /** 1행 POS 일일 번호와 동일 톤(색은 1행 헤더와 동일) */
  const togoPanelPosLikeTextColor = (panelRowLightBg: boolean) =>
    panelRowLightBg ? '#1e1e1e' : 'rgba(255,255,255,0.88)';

  /** 우측 투고 패널 카드: 시각은 1행 POS#와 동일 px·font-bold, AM/PM만 더 작게 */
  const renderTogoPanelTimeAmPm = (t?: string | null, panelRowLightBg = false): React.ReactNode => {
    const s = formatTimeAmPm(t);
    if (!s) return '';
    const trimmed = s.trim();
    const m = trimmed.match(/^(.+?)\s+(AM|PM)$/i);
    const posColor = togoPanelPosLikeTextColor(panelRowLightBg);
    const clockPx = togoPanelCardPickupClockPx;
    const merPx = Math.max(6, Math.round(togoPanelCardLine1Px * 0.42));
    if (!m) {
      return (
        <span className="font-bold tabular-nums leading-none" style={{ color: posColor, fontSize: `${clockPx}px` }}>
          {s}
        </span>
      );
    }
    const clockPart = m[1];
    const mer = m[2].toUpperCase() === 'PM' ? 'PM' : 'AM';
    return (
      <>
        <span className="font-bold tabular-nums leading-none" style={{ color: posColor, fontSize: `${clockPx}px` }}>
          {clockPart}
        </span>
        <span
          className="tabular-nums font-semibold leading-none"
          style={{ fontSize: `${merPx}px`, fontWeight: 600, color: posColor, opacity: panelRowLightBg ? 0.82 : 0.78 }}
        >
          {'\u00A0'}
          {mer}
        </span>
      </>
    );
  };

  /** 투고 패널 카드 2행 우측: 전화 4자리·이름·POS# — 전화는 1행 POS#와 동일 px·bold·전부 표시, 이름만 소형·촘촘 */
  const renderTogoPanelDisplayIdContent = (
    panelRowLightBg: boolean,
    phone?: string | null,
    name?: string | null,
    posOrderNum?: string | number | null
  ): React.ReactNode => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length > 0) {
      const tail = digits.length > 4 ? digits.slice(-4) : digits;
      const posColor = togoPanelPosLikeTextColor(panelRowLightBg);
      return (
        <span
          className="shrink-0 whitespace-nowrap font-bold tabular-nums leading-none"
          style={{ color: posColor, fontSize: `${togoPanelCardChannelOrderPx}px` }}
        >
          {tail}
        </span>
      );
    }
    return (
      <span
        className="min-w-0 truncate pl-0 text-right font-semibold leading-none"
        style={{
          color: togoPanelPosLikeTextColor(panelRowLightBg),
          fontSize: `${Math.max(10, Math.round(togoPanelCardLine2Px * 0.88 * 0.93))}px`,
          maxWidth: '3.25rem',
        }}
      >
        {formatTogoPanelDisplayId(phone, name, posOrderNum)}
      </span>
    );
  };

  const renderOnlineQueueCardSecondLineRightContent = (
    panelRowLightBg: boolean,
    phone?: string | null,
    posOrderNum?: string | number | null
  ): React.ReactNode => {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length > 0) {
      const tail = digits.length > 4 ? digits.slice(-4) : digits;
      const posColor = togoPanelPosLikeTextColor(panelRowLightBg);
      return (
        <span
          className="shrink-0 whitespace-nowrap font-bold tabular-nums leading-none"
          style={{ color: posColor, fontSize: `${togoPanelCardChannelOrderPx}px` }}
        >
          {tail}
        </span>
      );
    }
    return (
      <span
        className="min-w-0 truncate pl-0 text-right font-semibold leading-none"
        style={{
          color: togoPanelPosLikeTextColor(panelRowLightBg),
          fontSize: `${Math.max(10, Math.round(togoPanelCardLine2Px * 0.88 * 0.93))}px`,
          maxWidth: '3.25rem',
        }}
      >
        {formatOnlineQueueCardSecondLineRight(phone, posOrderNum)}
      </span>
    );
  };

  /** POS 일일 순번(데이 오픈 후 001~)만 표시. SQLite PK·타임스탬프·TZO- 등에서 숫자만 뽑아 큰 번호가 되는 것을 막음 */
  const isDailyPosDisplayDigits = (v: unknown): boolean => {
    if (v == null || v === '') return false;
    const raw = String(v).trim().replace(/^#/, '');
    if (!/^\d+$/.test(raw)) return false;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 999999;
  };

  const formatPosNumber = (orderNumber?: string | number | null): string => {
    if (orderNumber == null || orderNumber === '') return '—';
    const raw = String(orderNumber).trim().replace(/^#/, '');
    if (!isDailyPosDisplayDigits(raw)) return '—';
    const num = Number(raw);
    return `#${String(num).padStart(3, '0')}`;
  };

  const formatOrderPhoneDisplay = (input?: string | null) => {
    const digits = (input || '').replace(/\D/g, '');
    if (!digits) return input || '';
    const len = digits.length;
    if (len <= 4) return digits;
    if (len === 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
    if (len === 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (len === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (len === 8) return `(${digits.slice(0, 1)})${digits.slice(1, 4)}-${digits.slice(4)}`;
    if (len === 9) return `(${digits.slice(0, 2)})${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (len === 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (len === 11) return `(${digits.slice(0, 3)})${digits.slice(3, 7)}-${digits.slice(7)}`;
    return digits;
  };
  const formatOrderListDate = (order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time;
    if (!source) return '—';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return source;
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };
  const formatOrderHistoryDate = (order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time;
    if (!source) return '—';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };
  const formatOrderListSummary = (order: any) => {
    if (Array.isArray(order?.items) && order.items.length) {
      return buildOrderItemPreview(order.items);
    }
    if (order?.summary) return order.summary;
    return 'View order';
  };
  const currentMenuPriceMap = useMemo(() => {
    if (!menuCache || !Array.isArray(menuCache.menuItems) || menuCache.menuItems.length === 0) {
      return null;
    }
    const map = new Map<string, number>();
    menuCache.menuItems.forEach((item: any) => {
      if (!item || item.id == null) return;
      map.set(String(item.id), Number(item.price || 0));
    });
    return map;
  }, [menuCache?.menuItems]);
  const getOrderTotalValue = (order: any) => {
    const raw =
      order?.total ??
      order?.total_amount ??
      order?.order_total ??
      order?.amount ??
      order?.orderTotal ??
      0;
    const num = Number(raw);
    if (!Number.isFinite(num)) return 0;
    return num;
  };
  const formatNameWithTrailingSpace = (value: string) => {
    if (value == null) return '';
    const raw = String(value);
    const hasTrailingSpace = /\s$/.test(raw);
    const formatted = formatNameForDisplay(raw);
    if (!formatted && hasTrailingSpace) {
      return ' ';
    }
    return hasTrailingSpace && formatted ? `${formatted} ` : formatted;
  };
  const parseJsonSafe = (value: any, fallback: any = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };
  const sanitizeDisplayName = (value?: string | null) => {
    const formatted = formatNameForDisplay(value || '');
    if (!formatted) return '';
    return formatted.trim().toLowerCase() === 'unknown' ? '' : formatted;
  };

  const updateTogoField = (
    target: 'phone' | 'name' | 'address' | 'note' | 'zip',
    transformer: (value: string) => string
  ) => {
    switch (target) {
      case 'phone': {
        let nextValue = '';
        setCustomerPhone((prev) => {
          nextValue = formatTogoPhone(transformer(String(prev || '')));
          return nextValue;
        });
        updateCustomerSuggestions('phone', nextValue);
        break;
      }
      case 'name': {
        let nextValue = '';
        setCustomerName((prev) => {
          nextValue = formatNameWithTrailingSpace(transformer(String(prev || '')));
          return nextValue;
        });
        updateCustomerSuggestions('name', formatNameForDisplay(nextValue));
        break;
      }
      case 'address':
        setCustomerAddress((prev) => transformer(String(prev || '')));
        break;
      case 'note':
        setTogoNote((prev) => transformer(String(prev || '')));
        break;
      case 'zip':
        setCustomerZip((prev) => transformer(String(prev || '')));
        break;
      default:
        break;
    }
  };
  // placeholders for future functions (moved below)
  const handleHistoryOrderClick = (rawId: number | string) => {
    const normalized = normalizeOrderId(rawId);
    if (normalized == null) return;
    setSelectedHistoryOrderId(normalized);
  };
  const keyboardDisplayText = useMemo(() => {
    const target = togoKeyboardTarget || 'phone';
    const labelMap: Record<'phone' | 'name' | 'address' | 'note' | 'zip', string> = {
      phone: 'Phone',
      name: 'Name',
      address: 'Address',
      note: 'Note',
      zip: 'Zip',
    };
    const valueMap: Record<'phone' | 'name' | 'address' | 'note' | 'zip', string> = {
      phone: customerPhone,
      name: customerName,
      address: customerAddress,
      note: togoNote,
      zip: customerZip,
    };
    return `${labelMap[target]}: ${valueMap[target] || ''}`;
  }, [togoKeyboardTarget, customerPhone, customerName, customerAddress, togoNote, customerZip]);

  const getActiveTogoField = useCallback((): HTMLInputElement | HTMLTextAreaElement | null => {
    switch (togoKeyboardTarget) {
      case 'phone':
        return phoneInputRef.current;
      case 'name':
        return nameInputRef.current;
      case 'address':
        return addressInputRef.current;
      case 'note':
        return noteInputRef.current;
      case 'zip':
        return zipInputRef.current;
      default:
        return phoneInputRef.current;
    }
  }, [togoKeyboardTarget]);

  const ensureTogoFieldFocus = useCallback(() => {
    if (!showTogoOrderModal) return;
    const targetElement = getActiveTogoField();
    if (!targetElement) return;
    requestAnimationFrame(() => {
      targetElement.focus({ preventScroll: true });
      if (
        typeof targetElement.selectionStart === 'number' &&
        typeof targetElement.selectionEnd === 'number'
      ) {
        const length = targetElement.value?.length ?? 0;
        try {
          targetElement.setSelectionRange(length, length);
        } catch {
          // ignore selection errors
        }
      }
    });
  }, [getActiveTogoField, showTogoOrderModal]);

  useEffect(() => {
    ensureTogoFieldFocus();
  }, [ensureTogoFieldFocus, togoKeyboardTarget]);
  const handleTogoKeyboardType = (char: string) => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, (prev) => `${prev}${char}`);
    ensureTogoFieldFocus();
  };
  const handleTogoKeyboardBackspace = () => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, (prev) => prev.slice(0, -1));
    ensureTogoFieldFocus();
  };
  const handleTogoKeyboardClear = () => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, () => '');
    ensureTogoFieldFocus();
  };
  const handlePhoneInputChange = (value: string) => {
    const formatted = formatTogoPhone(value);
    setCustomerPhone(formatted);
    customerPhoneRef.current = formatted; // refë„ ë™ê¸°í™”
    updateCustomerSuggestions('phone', formatted);
  };
  const handleNameInputChange = (value: string) => {
    const formatted = formatNameWithTrailingSpace(value);
    setCustomerName(formatted);
    updateCustomerSuggestions('name', formatNameForDisplay(value));
  };
  const handleSuggestionBlur = () => {
    scheduleSuggestionHide();
  };

  const getFieldBorderClasses = (field: 'phone' | 'name' | 'address' | 'note' | 'zip') =>
    togoKeyboardTarget === field
      ? 'border-2 border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
      : 'border border-slate-300';

  // Togo ì£¼ë¬¸ ëª©ë¡ ìƒíƒœ
  const [togoOrders, setTogoOrders] = useState<any[]>([]);
  const [onlineQueueCards, setOnlineQueueCards] = useState<OnlineQueueCard[]>(() =>
    createInitialOnlineQueueCards()
  );

  useEffect(() => {
    togoOrdersPanelSyncRef.current = togoOrders;
    onlineQueueCardsPanelSyncRef.current = onlineQueueCards;
  }, [togoOrders, onlineQueueCards]);

  /** Pickup List 모달 + Pickup 모드: 패널 결제/숨김 상태를 목록 행에 반영 */
  useEffect(() => {
    if (!showOrderListModal || orderListOpenMode !== 'pickup') return;
    setOrderListOrders((prev) => {
      const next = applyPanelSyncToPickupListRows(
        prev,
        togoOrders,
        onlineQueueCards,
        swipeRemovedPanelIdsRef.current
      );
      if (next.length !== prev.length) return next;
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (String(next[i]?.status || '') !== String(prev[i]?.status || '')) {
          changed = true;
          break;
        }
      }
      return changed ? next : prev;
    });
  }, [togoOrders, onlineQueueCards, showOrderListModal, orderListOpenMode]);

  /** Pickup 모드: 목록 행 status가 패널 동기화로 바뀌면 선택 주문 상세의 status도 맞춤 */
  useEffect(() => {
    if (orderListOpenMode !== 'pickup' || !orderListSelectedOrder?.id) return;
    const found = (orderListOrders || []).find((o: any) => String(o?.id) === String(orderListSelectedOrder.id));
    if (!found) return;
    const fs = String(found.status || '').toUpperCase();
    const ss = String(orderListSelectedOrder.status || '').toUpperCase();
    if (fs === ss) return;
    setOrderListSelectedOrder((prev: any) =>
      prev && String(prev.id) === String(found.id) ? { ...prev, status: found.status } : prev
    );
  }, [orderListOrders, orderListSelectedOrder?.id, orderListOpenMode]);

  /** 후 고객 인포 취소 시 OrderPage에서 전달: 임시 투고 패널 카드 제거 후 one-shot state 정리 */
  useEffect(() => {
    const raw = (location.state as any)?.abandonTogoProvisionalId;
    if (raw == null || raw === '') return;
    const sid = String(raw);
    setTogoOrders((prev) => prev.filter((o) => String(o?.id) !== sid));
    setTogoOrderMeta((prev) => {
      if (!prev[sid]) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    navigate('/sales', { replace: true, state: {} });
  }, [location.state, navigate]);

  // Prevent "zombie" state: if the selected order disappears from the list, close/clear the detail modal.
  useEffect(() => {
    if (!showOrderDetailModal) return;
    if (!selectedOrderDetail) return;

    const selectedId = selectedOrderDetail?.id;
    if (selectedId == null) return;

    const pool = selectedOrderType === 'online' ? onlineQueueCards : togoOrders;
    const exists = Array.isArray(pool) && pool.some((o: any) => String(o?.id) === String(selectedId));
    if (!exists) {
      setShowOrderDetailModal(false);
      setSelectedOrderDetail(null);
      setSelectedOrderType(null);
    }
  }, [showOrderDetailModal, selectedOrderDetail, selectedOrderType, onlineQueueCards, togoOrders]);

  const displayedHistoryOrders = useMemo(() => {
    return [...customerHistoryOrders].slice(0, 6);
  }, [customerHistoryOrders]);
  const resetCustomerHistoryView = useCallback(() => {
    historyFetchIdRef.current += 1;
    setCustomerHistoryOrders([]);
    setCustomerHistoryError('');
    setCustomerHistoryLoading(false);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    setHistoryLoading(false);
  }, []);
  const resetTogoModalAfterAction = useCallback(() => {
    setShowTogoOrderModal(false);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerZip('');
    setTogoNote('');
    setTogoOrderMode('togo');
    setPrepButtonsLocked(false);
    setPickupTime(15);
    setPickupAmPm(getCurrentAmPm());
    setPickupDateLabel(formatPickupDateLabel());
    setSelectedTogoServer(null);
    setSelectedCustomerHistory(null);
    setCustomerSuggestions([]);
    setCustomerSuggestionSource(null);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    resetCustomerHistoryView();
    setHistoryDetailsMap({});
  }, [resetCustomerHistoryView]);
  const fetchCustomerHistoryForSelection = useCallback(
    async (selection: CustomerSuggestion | null) => {
      const fetchId = ++historyFetchIdRef.current;
      console.log('[CustomerHistory] fetchCustomerHistoryForSelection called', {
        showTogoOrderModal,
        selection: selection ? { name: selection.name, phone: selection.phone, phoneRaw: selection.phoneRaw } : null
      });
      
      if (!showTogoOrderModal || !selection) {
        console.log('[CustomerHistory] Skipping - modal not open or no selection');
        setCustomerHistoryOrders([]);
        setCustomerHistoryError('');
        setCustomerHistoryLoading(false);
        setSelectedHistoryOrderId(null);
        setHistoryOrderDetail(null);
        return;
      }
      const digits = (selection.phoneRaw || '').replace(/\D/g, '').slice(0, 11);
      const nameTerm = formatNameForDisplay(selection.name).trim();
      console.log('[CustomerHistory] Parsed values:', { digits, digitsLength: digits.length, nameTerm, nameLength: nameTerm.length });
      
      if (digits.length < 2 && nameTerm.length < 2) {
        console.log('[CustomerHistory] Skipping - digits and name too short');
        setCustomerHistoryOrders([]);
        setCustomerHistoryError('');
        setCustomerHistoryLoading(false);
        setSelectedHistoryOrderId(null);
        setHistoryOrderDetail(null);
        return;
      }
      setCustomerHistoryLoading(true);
      setCustomerHistoryError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (digits.length >= 2) {
          params.set('customerPhone', digits);
        } else {
          params.set('customerName', nameTerm);
        }
        const url = `${API_URL}/orders?${params.toString()}`;
        console.log('[CustomerHistory] Fetching:', url);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load customer history.');
        const data = await res.json();
        console.log('[CustomerHistory] API Response:', { success: data.success, ordersCount: data.orders?.length || 0 });
        if (historyFetchIdRef.current !== fetchId) return;
        const orders = Array.isArray(data.orders) ? data.orders : [];
        orders.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
        console.log('[CustomerHistory] Setting customerHistoryOrders:', orders.length, 'orders');
        setCustomerHistoryOrders(orders);
      } catch (error: any) {
        console.error('[CustomerHistory] Error:', error);
        if (historyFetchIdRef.current !== fetchId) return;
        setCustomerHistoryError(error?.message || 'Failed to load customer history.');
        setCustomerHistoryOrders([]);
      } finally {
        if (historyFetchIdRef.current === fetchId) {
          setCustomerHistoryLoading(false);
        }
      }
    },
    [getOrderTimestamp, showTogoOrderModal]
  );

  const clearCustomerSuggestions = useCallback(() => {
    setCustomerSuggestions([]);
    setCustomerSuggestionSource(null);
  }, []);
  const virtualOrderLookup = useMemo(() => {
    const lookup: Record<string, { orderId: string; channel: VirtualOrderChannel; order: any }> = {};
    togoOrders.forEach((order) => {
      const key = String(order.id);
      const meta = togoOrderMeta[key];
      const resolvedVirtualId = (order.virtualTableId && String(order.virtualTableId)) || meta?.virtualTableId;
      if (!resolvedVirtualId) return;
      const resolvedChannel = order.virtualChannel || meta?.channel || 'togo';
      lookup[resolvedVirtualId] = {
        orderId: key,
        channel: resolvedChannel,
        order,
      };
    });
    onlineQueueCards.forEach((order) => {
      const resolvedVirtualId = order.virtualTableId ? String(order.virtualTableId) : null;
      if (!resolvedVirtualId) return;
      const resolvedChannel = order.virtualChannel || 'online';
      lookup[resolvedVirtualId] = {
        orderId: String(order.id),
        channel: resolvedChannel,
        order,
      };
    });
    return lookup;
  }, [onlineQueueCards, togoOrders, togoOrderMeta]);

  const getVirtualIdForOrder = useCallback(
    (order: any, channel: VirtualOrderChannel) => {
      if (order?.virtualTableId) {
        return String(order.virtualTableId);
      }
      if (channel === 'togo') {
        return togoOrderMeta[String(order?.id)]?.virtualTableId || null;
      }
      return null;
    },
    [togoOrderMeta]
  );



  const updateTableStatus = useCallback(
    (
      tableId: string | null | undefined,
      nextStatus?: string | null,
      extra?: Partial<Pick<TableElement, 'current_order_id' | 'status'>>
    ) => {
      if (!tableId) return;
      setTableElements((prev) =>
        prev.map((element) => {
          if (String(element.id) !== String(tableId)) return element;
          const patch: Partial<TableElement> = { ...(extra || {}) };
          if (nextStatus) {
            patch.status = nextStatus;
          }
          return Object.keys(patch).length > 0 ? { ...element, ...patch } : element;
        })
      );
    },
    [setTableElements]
  );


  const loadOnlineOrders = useCallback(async () => {
    // localStorage → 없으면 SQLite business_profile( initial-setup-status )에서 보강 (데모·초기 기동 레이스 대응)
    let currentRestaurantId =
      localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
    if (!currentRestaurantId) {
      try {
        const res = await fetch(`${API_URL}/admin-settings/initial-setup-status`);
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { restaurantId?: string | null } | null;
          const rid = data?.restaurantId != null ? String(data.restaurantId).trim() : '';
          if (rid) {
            localStorage.setItem('firebaseRestaurantId', rid);
            localStorage.setItem('firebase_restaurant_id', rid);
            currentRestaurantId = rid;
            setOnlineOrderRestaurantId(rid);
            setRestaurantIdReady(true);
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!currentRestaurantId) {
      if (onlineOrderRestaurantId) setOnlineOrderRestaurantId(null);
      return;
    }

    if (currentRestaurantId !== onlineOrderRestaurantId) {
      setOnlineOrderRestaurantId(currentRestaurantId);
    }
    
    try {
      // ëª¨ë“  ìƒíƒœì˜ ì£¼ë¬¸ì„ ë¶ˆëŸ¬ì˜¤ë˜, cancelled ì œì™¸ (ê²°ì œ ì™„ë£Œëœ completedë„ í¬í•¨)
      const res = await fetch(`${API_URL}/online-orders/${currentRestaurantId}`);
      if (!res.ok) return;
      const json = await res.json();
      const orders = Array.isArray(json.orders) ? json.orders : [];
      
      // ì˜¨ë¼ì¸ ì•±ì—ì„œ ë“¤ì–´ì˜¨ ì£¼ë¬¸ë§Œ í‘œì‹œ (pickup, delivery, online íƒ€ìž…)
      const filteredOrders = orders.filter((o: any) => {
        const orderType = (o.orderType || '').toLowerCase();
        const status = (o.status || '').toLowerCase();
        const customerName = (o.customerName || '').toLowerCase().trim();
        const src = String(o.source || '').toUpperCase();
        const tableIdUpper = String(o.tableId || o.table_id || '').trim().toUpperCase();
        if (src === 'POS' && (orderType === 'delivery' || tableIdUpper.startsWith('DL'))) return false;

        // POSì—ì„œ ìƒì„±ëœ ì£¼ë¬¸ ì œì™¸
        if (orderType === 'dine_in' || orderType === 'dine-in') return false;
        if (orderType === 'togo') return false;
        if (orderType === 'pos') return false;
        
        // POS Order ê³ ê°ëª… ì œì™¸
        if (customerName === 'pos order') return false;
        
        // Table Order ì œì™¸
        if (customerName === 'table order' || customerName.startsWith('table ')) return false;
        
        // cancelled ìƒíƒœ ì œì™¸
        if (status === 'cancelled') return false;
        
        // picked_up ìƒíƒœ ì œì™¸ (í”½ì—… ì™„ë£Œëœ ì£¼ë¬¸)
        if (status === 'picked_up') return false;
        
        // merged ìƒíƒœ ì œì™¸ (ì´ë¯¸ ë¨¸ì§€ëœ ì£¼ë¬¸)
        if (status === 'merged') return false;
        
        // completed / paid 는 픽업 전 패널(Ready)에 남겨야 함 — picked_up 만 제외
        
        return true;
      });
      
      console.log('[loadOnlineOrders] Filtered orders:', filteredOrders.length);
      
      const mappedCards: OnlineQueueCard[] = filteredOrders.map((o: any, idx: number) => ({
        id: o.id,
        number: (() => {
          const fromSnake = String(o.posOrderNumber || o.order_number || '').trim().replace(/^#/, '');
          if (isDailyPosDisplayDigits(fromSnake)) return fromSnake;
          const fromCamel = String(o.orderNumber || '').trim().replace(/^#/, '');
          if (isDailyPosDisplayDigits(fromCamel)) return fromCamel;
          return '';
        })(),
        localOrderId: o.localOrderId || null, // SQLite ID ëª…ì‹œì  ì €ìž¥
        time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        phone: o.customerPhone || '',
        name: o.customerName || 'Online Order',
        items: (o.items || []).map((it: any) => it.name),
        virtualChannel: (() => {
          const ot = String(o.orderType || o.order_type || '').toUpperCase();
          const fm = String(o.fulfillmentMode || o.fulfillment_mode || '').toLowerCase();
          if (ot === 'DELIVERY' || fm === 'delivery') return 'delivery' as VirtualOrderChannel;
          return 'online';
        })(),
        virtualTableId: buildVirtualTableCode('online', idx + 1),
        fullOrder: o, // ì „ì²´ ë°ì´í„° ë³´ê´€
        // ì¶”ê°€ í•„ë“œ
        placedTime: o.createdAt,
        // Firebase Timestamp ê°ì²´ë¥¼ Dateë¡œ ë³€í™˜, ì—†ìœ¼ë©´ createdAt + 20ë¶„
        pickupTime: (() => {
          const pt = o.pickupTime || o.readyTime;
          if (pt) {
            if (pt._seconds) return new Date(pt._seconds * 1000);
            if (pt.seconds) return new Date(pt.seconds * 1000);
            const d = new Date(pt);
            if (!isNaN(d.getTime())) return d;
          }
          // pickupTime 없으면 주문 시각 + Utility에 맞춘 Thezone 프렙(분) — 카드에 표시하는 Ready 시각과 동일
          const created = o.createdAt;
          if (created) {
            let createdDate: Date;
            if (created._seconds) createdDate = new Date(created._seconds * 1000);
            else if (created.seconds) createdDate = new Date(created.seconds * 1000);
            else createdDate = new Date(created);
            if (!isNaN(createdDate.getTime())) {
              const prepStr = prepTimeSettingsRef.current?.thezoneorder?.time || '20m';
              const prepMin = parseInt(String(prepStr).replace(/[^\d]/g, ''), 10) || 20;
              return new Date(createdDate.getTime() + prepMin * 60000);
            }
          }
          return null;
        })(),
        total: o.total || 0,
        sequenceNumber: idx + 1,
        status: o.status || 'pending', // Firebaseì—ì„œ ê°€ì ¸ì˜¨ ìƒíƒœ
        onlineOrderNumber:
          String(
            o.orderNumber ||
              o.order_number ||
              o.externalOrderNumber ||
              o.displayOrderNumber ||
              o.firebaseOrderNumber ||
              o.onlineOrderNumber ||
              ''
          ).trim() || undefined,
      }));
      
      // ë””ë²„ê¹…: pickupTime í™•ì¸
      if (mappedCards.length > 0) {
        console.log('[DEBUG] First online order pickupTime:', {
          raw: filteredOrders[0]?.pickupTime,
          parsed: mappedCards[0]?.pickupTime,
          status: filteredOrders[0]?.status
        });
      }

      const hiddenOnlineSwipe = swipeRemovedPanelIdsRef.current;
      // 숨김 키를 "이번 응답에 없음"으로 지우지 않음. 그렇게 하면 API 레이스·필터 변동 시 키가
      // 사라져 같은 주문이 좀비처럼 다시 뜸. 키는 픽업/결제 완료 이벤트·스와이프 시에만 등록되며
      // 세션 동안 유지(페이지 새로고침 시 초기화).
      const mappedOnlineVisible = mappedCards.filter((c) => {
        if (hiddenOnlineSwipe.has(String(c.id))) return false;
        const loc = c.localOrderId != null ? String(c.localOrderId) : '';
        if (loc && hiddenOnlineSwipe.has(loc)) return false;
        const fl = (c as any).fullOrder?.localOrderId;
        if (fl != null && String(fl) !== '' && hiddenOnlineSwipe.has(String(fl))) return false;
        const fid = (c as any).fullOrder?.id;
        if (fid != null && String(fid) !== '' && hiddenOnlineSwipe.has(String(fid))) return false;
        const foid = String((c as any).fullOrder?.firebase_order_id || (c as any).fullOrder?.firebaseOrderId || '').trim();
        if (foid && hiddenOnlineSwipe.has(foid)) return false;
        const onum = String((c as any).onlineOrderNumber || '').trim();
        if (onum && hiddenOnlineSwipe.has(onum)) return false;
        return true;
      });
      
      // ìƒˆ ì£¼ë¬¸ ê°ì§€ (pending ìƒíƒœì´ê³  ì´ì „ì— ì—†ë˜ ì£¼ë¬¸)
      const currentOrderIds = filteredOrders.map((o: any) => o.id);
      
      // ì²« ë²ˆì§¸ ë¡œë“œ ì‹œì—ëŠ” ì•ŒëžŒìŒ ìž¬ìƒ ì•ˆí•¨ (íŽ˜ì´ì§€ ì§„ìž… ì‹œ ê¸°ì¡´ ì£¼ë¬¸ë“¤ì´ ìƒˆ ì£¼ë¬¸ìœ¼ë¡œ ì¸ì‹ë˜ëŠ” ê²ƒ ë°©ì§€)
      if (isFirstOnlineOrderLoadRef.current) {
        isFirstOnlineOrderLoadRef.current = false;
        previousOnlineOrdersRef.current = currentOrderIds;
        console.log('[loadOnlineOrders] ì²« ë¡œë“œ ì™„ë£Œ - ê¸°ì¡´ ì£¼ë¬¸ ID ì´ˆê¸°í™”:', currentOrderIds.length, 'ê±´');
        setOnlineQueueCards(mappedOnlineVisible);
        return;
      }
      
      const pendingOrders = filteredOrders.filter((o: any) => 
        (o.status || 'pending').toLowerCase() === 'pending' &&
        !previousOnlineOrdersRef.current.includes(o.id)
      );
      
      // 새 주문 처리: 채널(채널 슬러그/Urban Piper) 별 prepTimeSettings 모드 적용
      if (pendingOrders.length > 0) {
        const newOrder = pendingOrders[0];
        const { channelKey, mode, prepMinutes: chanPrepMinutes } = resolveOnlineOrderPrepConfig(newOrder);

        if (mode === 'auto') {
          if (!claimOnlineAutoAcceptPrintOnce(onlineAutoAcceptPrintOnceRef, newOrder.id)) {
            console.log('[loadOnlineOrders] Skip duplicate auto accept/print (already handled e.g. by SSE):', newOrder.id);
          } else {
            playOnlineOrderSound();
            console.log('[loadOnlineOrders] New order alarm played:', newOrder.id, 'channel:', channelKey);
            const prepMinutes = chanPrepMinutes;
            const pickupTime = getLocalDatetimeString(new Date(Date.now() + prepMinutes * 60000));

            console.log(`[loadOnlineOrders] Auto accepting order: ${newOrder.id}, channel: ${channelKey}, prepTime: ${prepMinutes}min, pickupTime: ${pickupTime}`);

            fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prepTime: prepMinutes, pickupTime, restaurantId: onlineOrderRestaurantId }),
            })
              .then(() => {
                console.log('[loadOnlineOrders] Order auto-accepted:', newOrder.id);
                return fetch(`${API_URL}/online-orders/order/${newOrder.id}/print`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ printerType: 'kitchen', restaurantId: onlineOrderRestaurantId }),
                });
              })
              .then(() => {
                console.log('[loadOnlineOrders] Kitchen ticket printed:', newOrder.id);
              })
              .catch((err) => {
                console.error('[loadOnlineOrders] Auto accept or print failed:', err);
              });
          }
        } else if (!showNewOrderAlert) {
          // Manual 모드: 알림 모달 표시 (Urban Piper / 딜리버리 채널 포함)
          playOnlineOrderSound();
          console.log('[loadOnlineOrders] New order alarm played:', newOrder.id, 'channel:', channelKey);
          setNewOrderAlertData(newOrder);
          setSelectedPrepTime(chanPrepMinutes || 20);
          setShowNewOrderAlert(true);
          console.log('[loadOnlineOrders] New order detected (manual mode):', newOrder.id, 'channel:', channelKey);
        }
      }
      
      // ì´ì „ ì£¼ë¬¸ ID ëª©ë¡ ì—…ë°ì´íŠ¸
      previousOnlineOrdersRef.current = currentOrderIds;
      
      setOnlineQueueCards(mappedOnlineVisible);
    } catch (error) {
      console.warn('Failed to load online orders:', error);
    }
  }, [API_URL, onlineOrderRestaurantId, playOnlineOrderSound]);

  useEffect(() => {
    loadOnlineOrders();
    const t = setInterval(loadOnlineOrders, 30000); // 30초마다 백업 갱신
    return () => clearInterval(t);
  }, [loadOnlineOrders]);

  // Day Off ë°ì´í„° ë¡œë“œ
  const loadDayOffDates = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/online-orders/day-off`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.dayOffs)) {
          setDayOffDates(data.dayOffs.map((d: any) => ({ 
            date: d.date, 
            channels: d.channels || 'all',
            type: d.type || 'closed'
          })));
        }
      }
    } catch (error) {
      console.warn('Failed to load day off dates:', error);
    }
  }, [API_URL]);

  useEffect(() => {
    loadDayOffDates();
  }, [loadDayOffDates]);

  // Day Off ë‚ ì§œ ì„ íƒ í† ê¸€ (UIìš© - ì•„ì§ ì €ìž¥ ì•ˆí•¨)
  const toggleDayOffSelection = (dateStr: string) => {
    setDayOffSaveStatus('idle'); // ë³€ê²½ ì‹œ ìƒíƒœ ë¦¬ì…‹
    setDayOffSelectedDates(prev => {
      if (prev.includes(dateStr)) {
        return prev.filter(d => d !== dateStr);
      } else {
        return [...prev, dateStr].sort();
      }
    });
  };

  // Day Off ì±„ë„ ì„ íƒ í† ê¸€
  const toggleDayOffChannel = (channel: string) => {
    setDayOffSaveStatus('idle'); // ë³€ê²½ ì‹œ ìƒíƒœ ë¦¬ì…‹
    if (channel === 'all') {
      // All Channels í† ê¸€: ì´ë¯¸ allì´ë©´ í•´ì œ, ì•„ë‹ˆë©´ all ì„ íƒ
      setDayOffSelectedChannels(prev => {
        if (prev.includes('all')) {
          return []; // ì „ì²´ í•´ì œ
        } else {
          return ['all']; // ì „ì²´ ì„ íƒ
        }
      });
    } else {
      setDayOffSelectedChannels(prev => {
        const newChannels = prev.filter(c => c !== 'all');
        if (newChannels.includes(channel)) {
          return newChannels.filter(c => c !== channel);
        } else {
          return [...newChannels, channel];
        }
      });
    }
  };

  // Day Off ì €ìž¥ (ì„ íƒëœ ë‚ ì§œë“¤ ì €ìž¥) - Firebase ë™ê¸°í™” í¬í•¨
  const saveDayOffs = async () => {
    // ì €ìž¥í•  ë‚ ì§œê°€ ì—†ê±°ë‚˜ ì´ë¯¸ ì €ìž¥ ì¤‘ì´ë©´ ë¬´ì‹œ
    if (dayOffSelectedDates.length === 0) {
      console.log('[Day Off] No dates selected');
      return;
    }
    if (dayOffSaveStatus === 'saving') {
      console.log('[Day Off] Already saving...');
      return;
    }

    const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
    console.log('[Day Off] Saving...', dayOffSelectedDates, dayOffSelectedChannels, dayOffType, 'restaurantId:', restaurantId);
    setDayOffSaveStatus('saving');
    
    const channelsStr = dayOffSelectedChannels.length === 0 || dayOffSelectedChannels.includes('all')
      ? 'all'
      : dayOffSelectedChannels.join(',');

    try {
      const res = await fetch(`${API_URL}/online-orders/day-off/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: dayOffSelectedDates,
          channels: channelsStr,
          type: dayOffType,
          restaurantId: restaurantId || undefined
        })
      });
      
      const data = await res.json();
      console.log('[Day Off] Response:', data);
      
      if (res.ok && data.success) {
        await loadDayOffDates();
        // ì €ìž¥ í›„ ì„ íƒëœ ë‚ ì§œ ì´ˆê¸°í™” (ë‹¬ë ¥ì— ì €ìž¥ëœ ìƒíƒœë¡œ í‘œì‹œ)
        setDayOffSelectedDates([]);
        setDayOffSaveStatus('saved');
        console.log('[Day Off] Save successful! (synced to Firebase)');
        // 3ì´ˆ í›„ saved ìƒíƒœ ì´ˆê¸°í™”
        setTimeout(() => setDayOffSaveStatus('idle'), 3000);
      } else {
        console.error('[Day Off] Save failed:', data);
        setDayOffSaveStatus('idle');
      }
    } catch (err) {
      console.error('[Day Off] Save error:', err);
      setDayOffSaveStatus('idle');
    }
  };

  // Day Off ì‚­ì œ - Firebase ë™ê¸°í™” í¬í•¨
  const removeDayOff = async (dateStr: string) => {
    try {
      const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
      const url = restaurantId 
        ? `${API_URL}/online-orders/day-off/${dateStr}?restaurantId=${restaurantId}`
        : `${API_URL}/online-orders/day-off/${dateStr}`;
      
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        setDayOffDates(prev => prev.filter(d => d.date !== dateStr));
        setDayOffSaveStatus('idle'); // ì‚­ì œ ì‹œ ìƒíƒœ ë¦¬ì…‹
        console.log('[Day Off] Removed:', dateStr, '(synced to Firebase)');
      }
    } catch (err) {
      console.error('Day off remove error:', err);
    }
  };

  // ===== Menu Hide íƒ­ ê¸°ëŠ¥ =====
  // ì¹´í…Œê³ ë¦¬ ëª©ë¡ ë¡œë“œ
  const loadMenuHideCategories = useCallback(async () => {
    try {
      setMenuHideLoading(true);
      // defaultMenuì—ì„œ menuId ê°€ì ¸ì˜¤ê¸°
      const menuId = defaultMenu.menuId || localStorage.getItem('menuId') || '200005';
      const response = await fetch(`${API_URL}/menu-visibility/categories?menu_id=${menuId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMenuHideCategories(data.categories);
        }
      }
    } catch (error) {
      console.error('Failed to load menu hide categories:', error);
    } finally {
      setMenuHideLoading(false);
    }
  }, [API_URL, defaultMenu.menuId]);

  // ì¹´í…Œê³ ë¦¬ë³„ ì•„ì´í…œ ë¡œë“œ
  const loadMenuHideItems = useCallback(async (categoryId: string) => {
    try {
      setMenuHideLoading(true);
      const response = await fetch(`${API_URL}/menu-visibility/items/${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMenuHideItems(data.items);
        }
      }
    } catch (error) {
      console.error('Failed to load menu hide items:', error);
    } finally {
      setMenuHideLoading(false);
    }
  }, [API_URL]);

  // ì•„ì´í…œ visibility í† ê¸€
  const toggleItemVisibility = async (itemId: string, field: 'online_visible' | 'delivery_visible') => {
    const item = menuHideItems.find(i => i.item_id === itemId);
    if (!item) return;
    
    const newValue = field === 'online_visible' 
      ? (item.online_visible === 1 ? 0 : 1)
      : (item.delivery_visible === 1 ? 0 : 1);
    
    // Optimistic update
    setMenuHideItems(prev => prev.map(i => 
      i.item_id === itemId ? { ...i, [field]: newValue } : i
    ));
    
    try {
      const response = await fetch(`${API_URL}/menu-visibility/item/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue })
      });
      
      if (response.ok) {
        // ì¹´í…Œê³ ë¦¬ ëª©ë¡ ìƒˆë¡œê³ ì¹¨ (hidden count ì—…ë°ì´íŠ¸)
        loadMenuHideCategories();
      } else {
        // Rollback on failure
        setMenuHideItems(prev => prev.map(i => 
          i.item_id === itemId ? { ...i, [field]: item[field] } : i
        ));
      }
    } catch (error) {
      console.error('Failed to toggle item visibility:', error);
      // Rollback on error
      setMenuHideItems(prev => prev.map(i => 
        i.item_id === itemId ? { ...i, [field]: item[field] } : i
      ));
    }
  };

  // ì¹´í…Œê³ ë¦¬ ì „ì²´ í† ê¸€
  const toggleCategoryVisibility = async (categoryId: string, field: 'online_visible' | 'delivery_visible', value: number) => {
    try {
      const response = await fetch(`${API_URL}/menu-visibility/category/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
      
      if (response.ok) {
        // í˜„ìž¬ ì¹´í…Œê³ ë¦¬ê°€ ì„ íƒë˜ì–´ ìžˆìœ¼ë©´ ì•„ì´í…œ ë¦¬ìŠ¤íŠ¸ ìƒˆë¡œê³ ì¹¨
        if (menuHideSelectedCategory === categoryId) {
          loadMenuHideItems(categoryId);
        }
        loadMenuHideCategories();
      }
    } catch (error) {
      console.error('Failed to toggle category visibility:', error);
    }
  };

  // Menu Hide íƒ­ ì—´ë¦´ ë•Œ ì¹´í…Œê³ ë¦¬ ë¡œë“œ
  useEffect(() => {
    if (onlineModalTab === 'menuhide' && showPrepTimeModal) {
      loadMenuHideCategories();
      setMenuHideSelectedCategory(null);
      setMenuHideItems([]);
    }
  }, [onlineModalTab, showPrepTimeModal, loadMenuHideCategories]);

  // Online Settings 모달 열릴 때 Firebase에서 전체 설정 로드
  const loadAllOnlineSettings = useCallback(async () => {
    try {
      const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
      if (!restaurantId) return;
      const res = await fetch(`${API_URL}/online-orders/online-settings?restaurantId=${restaurantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.settings) return;
      const s = data.settings;
      if (s.prepTimeSettings) {
        const def = { thezoneorder: { mode: 'auto' as const, time: '15m' }, ubereats: { mode: 'auto' as const, time: '15m' }, doordash: { mode: 'auto' as const, time: '15m' }, skipthedishes: { mode: 'auto' as const, time: '15m' } };
        setPrepTimeSettings({ ...def, ...s.prepTimeSettings });
        localStorage.setItem('prepTimeSettings', JSON.stringify({ ...def, ...s.prepTimeSettings }));
      }
      if (s.pauseSettings) {
        const chs = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const;
        const next = chs.reduce((acc, ch) => {
          const p = s.pauseSettings[ch];
          acc[ch] = { paused: p?.paused ?? false, pauseUntil: p?.pausedUntil ? new Date(p.pausedUntil) : null };
          return acc;
        }, {} as { thezoneorder: { paused: boolean; pauseUntil: Date | null }; ubereats: { paused: boolean; pauseUntil: Date | null }; doordash: { paused: boolean; pauseUntil: Date | null }; skipthedishes: { paused: boolean; pauseUntil: Date | null } });
        setPauseSettings(next);
      }
      if (s.dayOffDates && Array.isArray(s.dayOffDates)) {
        setDayOffDates(s.dayOffDates);
      }
      if (s.utilitySettings) {
        const nextBag = { enabled: s.utilitySettings.bagFee?.enabled ?? false, amount: s.utilitySettings.bagFee?.amount ?? 0.10 };
        setUtilitySettings({
          bagFee: nextBag,
          utensils: { enabled: s.utilitySettings.utensils?.enabled ?? false },
          preOrderReprint: { enabled: s.utilitySettings.preOrderReprint?.enabled ?? false },
        });
        syncPosBagFeeLocalFromUtilityBagFee(nextBag);
      }
    } catch (error) {
      console.error('Failed to load online settings:', error);
    }
  }, [API_URL]);

  useEffect(() => {
    if (showPrepTimeModal) loadAllOnlineSettings();
  }, [showPrepTimeModal, loadAllOnlineSettings]);

  const loadUtilitySettings = useCallback(async () => {
    try {
      const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
      const url = restaurantId ? `${API_URL}/online-orders/utility-settings?restaurantId=${restaurantId}` : `${API_URL}/online-orders/utility-settings`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.utilitySettings) {
          const nextBag = { enabled: data.utilitySettings.bagFee?.enabled ?? false, amount: data.utilitySettings.bagFee?.amount ?? 0.10 };
          setUtilitySettings({
            bagFee: nextBag,
            utensils: { enabled: data.utilitySettings.utensils?.enabled ?? false },
            preOrderReprint: { enabled: data.utilitySettings.preOrderReprint?.enabled ?? false },
          });
          syncPosBagFeeLocalFromUtilityBagFee(nextBag);
        }
      }
    } catch (error) {
      console.error('Failed to load utility settings:', error);
    }
  }, [API_URL]);

  const saveUtilitySettings = async () => {
    setSavingUtility(true);
    try {
      const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
      const res = await fetch(`${API_URL}/online-orders/utility-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utilitySettings, restaurantId }),
      });
      const data = await res.json();
      if (data.success) {
        syncPosBagFeeLocalFromUtilityBagFee(utilitySettings.bagFee);
        alert('Utility settings saved!');
      } else alert('Failed to save: ' + (data.error || 'Unknown error'));
    } catch (error) {
      alert('Failed to save utility settings');
    } finally {
      setSavingUtility(false);
    }
  };

  useEffect(() => {
    if (onlineModalTab === 'utility' && showPrepTimeModal) loadUtilitySettings();
  }, [onlineModalTab, showPrepTimeModal, loadUtilitySettings]);

  // ì¹´í…Œê³ ë¦¬ ì„ íƒ ì‹œ ì•„ì´í…œ ë¡œë“œ
  useEffect(() => {
    if (menuHideSelectedCategory) {
      loadMenuHideItems(menuHideSelectedCategory);
    }
  }, [menuHideSelectedCategory, loadMenuHideItems]);

  const menuHideRefreshRef = React.useRef({ tab: 'preptime' as string, modalOpen: false, category: null as string | null });
  useEffect(() => {
    menuHideRefreshRef.current = { tab: onlineModalTab, modalOpen: showPrepTimeModal, category: menuHideSelectedCategory };
  }, [onlineModalTab, showPrepTimeModal, menuHideSelectedCategory]);

  // Auto-sync: DB에서 restaurantId를 가져와 localStorage에 저장 (SSE 연결 전 보장)
  const [restaurantIdReady, setRestaurantIdReady] = useState(false);
  useEffect(() => {
    const existing = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
    if (existing) {
      if (!localStorage.getItem('firebaseRestaurantId')) {
        localStorage.setItem('firebaseRestaurantId', existing);
      }
      setRestaurantIdReady(true);
      return;
    }
    fetch(`${API_URL}/admin-settings/initial-setup-status`)
      .then(res => res.json())
      .then(data => {
        if (data.restaurantId) {
          localStorage.setItem('firebaseRestaurantId', data.restaurantId);
          localStorage.setItem('firebase_restaurant_id', data.restaurantId);
          setOnlineOrderRestaurantId(data.restaurantId);
          setRestaurantIdReady(true);
        }
      })
      .catch(() => {});
  }, []);

  // SSE
  useEffect(() => {
    const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
    if (!restaurantId) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      eventSource = new EventSource(`${API_URL}/online-orders/stream/${restaurantId}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[SSE] Message received:', data.type);

          if (data.type === 'new_order') {
            // 새 주문 푸시 수신
            const newOrder = data.order;
            console.log('[SSE] New order received:', newOrder.id);
            const { channelKey, mode, prepMinutes: chanPrepMinutes } = resolveOnlineOrderPrepConfig(newOrder);

            if (mode === 'auto') {
              if (!claimOnlineAutoAcceptPrintOnce(onlineAutoAcceptPrintOnceRef, newOrder.id)) {
                console.log('[SSE] Skip duplicate auto accept/print (already handled e.g. by polling):', newOrder.id);
              } else {
                playOnlineOrderSound();
                const prepMinutes = chanPrepMinutes;
                const pickupTime = getLocalDatetimeString(new Date(Date.now() + prepMinutes * 60000));

                console.log(`[SSE] Auto accepting order: ${newOrder.id}, channel: ${channelKey}, prepTime: ${prepMinutes}min`);

                fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prepTime: prepMinutes, pickupTime, restaurantId: onlineOrderRestaurantId }),
                })
                  .then(() => {
                    console.log('[SSE] Order auto-accepted:', newOrder.id);
                    return fetch(`${API_URL}/online-orders/order/${newOrder.id}/print`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ printerType: 'kitchen', restaurantId: onlineOrderRestaurantId }),
                    });
                  })
                  .then(() => {
                    console.log('[SSE] Kitchen ticket printed:', newOrder.id);
                    loadOnlineOrders();
                  })
                  .catch((err) => {
                    console.error('[SSE] Auto accept or print failed:', err);
                  });
              }
            } else if (!showNewOrderAlert) {
              // Manual 모드: 알림 모달 (Urban Piper / 딜리버리 채널 포함)
              playOnlineOrderSound();
              console.log('[SSE] Manual mode — open accept modal:', newOrder.id, 'channel:', channelKey);
              setNewOrderAlertData(newOrder);
              setSelectedPrepTime(chanPrepMinutes || 20);
              setShowNewOrderAlert(true);
            }

            // ëª©ë¡ ì¦‰ì‹œ ê°±ì‹ 
            loadOnlineOrders();
          } else if (data.type === 'order_updated') {
            loadOnlineOrders();
          } else if (data.type === 'online_settings_changed' && data.settings) {
            const s = data.settings;
            if (s.prepTimeSettings) {
              const def = { thezoneorder: { mode: 'auto' as const, time: '15m' }, ubereats: { mode: 'auto' as const, time: '15m' }, doordash: { mode: 'auto' as const, time: '15m' }, skipthedishes: { mode: 'auto' as const, time: '15m' } };
              setPrepTimeSettings({ ...def, ...s.prepTimeSettings });
              localStorage.setItem('prepTimeSettings', JSON.stringify({ ...def, ...s.prepTimeSettings }));
            }
            if (s.pauseSettings) {
              const chs = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const;
              const next = chs.reduce((acc, ch) => {
                const p = s.pauseSettings[ch];
                acc[ch] = { paused: p?.paused ?? false, pauseUntil: p?.pausedUntil ? new Date(p.pausedUntil) : null };
                return acc;
              }, {} as { thezoneorder: { paused: boolean; pauseUntil: Date | null }; ubereats: { paused: boolean; pauseUntil: Date | null }; doordash: { paused: boolean; pauseUntil: Date | null }; skipthedishes: { paused: boolean; pauseUntil: Date | null } });
              setPauseSettings(next);
            }
            if (s.dayOffDates && Array.isArray(s.dayOffDates)) setDayOffDates(s.dayOffDates);
            if (s.utilitySettings) {
              const nextBag = { enabled: s.utilitySettings.bagFee?.enabled ?? false, amount: s.utilitySettings.bagFee?.amount ?? 0.10 };
              setUtilitySettings({
                bagFee: nextBag,
                utensils: { enabled: s.utilitySettings.utensils?.enabled ?? false },
                preOrderReprint: { enabled: s.utilitySettings.preOrderReprint?.enabled ?? false },
              });
              syncPosBagFeeLocalFromUtilityBagFee(nextBag);
            }
          } else if (data.type === 'menu_visibility_changed') {
            const { tab, modalOpen, category } = menuHideRefreshRef.current;
            if (tab === 'menuhide' && modalOpen) {
              loadMenuHideCategories();
              if (category) loadMenuHideItems(category);
            }
          }
        } catch (error) {
          console.warn('[SSE] Parse error:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('[SSE] Connection error, reconnecting in 5s...', error);
        eventSource?.close();
        // 5ì´ˆ í›„ ìž¬ì—°ê²°
        reconnectTimeout = setTimeout(connectSSE, 5000);
      };

      eventSource.onopen = () => {
        console.log('[SSE] Connected to online orders stream');
      };
    };

    connectSSE();

    return () => {
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [API_URL, showNewOrderAlert, loadOnlineOrders, restaurantIdReady]);

  const loadTogoOrders = useCallback(async () => {
    try {
      const today = getLocalDateString();
      const [togoRes, deliveryRes, onlineRes, deliveryOrdersRes] = await Promise.all([
        fetch(`${API_URL}/orders?type=TOGO,PICKUP,TAKEOUT&date=${today}&session_scope=1&limit=200&service_pattern=TAKEOUT`),
        fetch(`${API_URL}/orders?type=DELIVERY&limit=200&panel=1&date=${today}&session_scope=1&service_pattern=TAKEOUT`),
        fetch(`${API_URL}/orders?type=ONLINE&date=${today}&session_scope=1&limit=200&service_pattern=TAKEOUT`),
        fetch(`${API_URL}/orders/delivery-orders`),
      ]);
      
      const togoJson = togoRes.ok ? await togoRes.json() : { orders: [] };
      const deliveryJson = deliveryRes.ok ? await deliveryRes.json() : { orders: [] };
      const onlineJson = onlineRes.ok ? await onlineRes.json() : { orders: [] };
      const deliveryOrdersJson = deliveryOrdersRes.ok ? await deliveryOrdersRes.json() : { orders: [] };
      
      const EXCLUDE_STATUSES = ['PICKED_UP', 'CANCELLED', 'MERGED', 'CLOSED', 'VOIDED', 'VOID', 'REFUNDED'];
      const togoAllOrders = (Array.isArray(togoJson.orders) ? togoJson.orders : []).filter((o: any) => !EXCLUDE_STATUSES.includes((o.status || '').toUpperCase()));
      const deliveryAllRaw = (Array.isArray(deliveryJson.orders) ? deliveryJson.orders : []);
      const deliveryAllOrders = deliveryAllRaw.filter((o: any) => !EXCLUDE_STATUSES.includes((o.status || '').toUpperCase()));
      const deliveryDoneIds = new Set(deliveryAllRaw.filter((o: any) => {
        const st = (o.status || '').toUpperCase();
        return EXCLUDE_STATUSES.includes(st);
      }).map((o: any) => {
        if (o.table_id && String(o.table_id).startsWith('DL')) return String(o.table_id).substring(2);
        return null;
      }).filter(Boolean));
      const onlineAllOrders = (Array.isArray(onlineJson.orders) ? onlineJson.orders : []).filter((o: any) => !EXCLUDE_STATUSES.includes((o.status || '').toUpperCase()));
      const allDeliveryMeta = Array.isArray(deliveryOrdersJson.orders) ? deliveryOrdersJson.orders : [];
      const deliveryMetaOrders = allDeliveryMeta.filter((m: any) => {
        const st = (m.status || '').toUpperCase();
        if (EXCLUDE_STATUSES.includes(st)) return false;
        if (deliveryDoneIds.has(String(m.id))) return false;
        return true;
      });
      
      // ë””ë²„ê·¸ ë¡œê·¸
      console.log('ðŸš— [loadTogoOrders] togoAllOrders:', togoAllOrders.length);
      console.log('ðŸš— [loadTogoOrders] deliveryAllOrders:', deliveryAllOrders.length);
      console.log('ðŸš— [loadTogoOrders] deliveryMetaOrders:', deliveryMetaOrders.length, deliveryMetaOrders);
      
      // ë‘ ëª©ë¡ í•©ì¹˜ê¸° (ì¤‘ë³µ ì œê±°)
      const orderMap = new Map();
      [...togoAllOrders, ...deliveryAllOrders, ...onlineAllOrders].forEach(o => orderMap.set(o.id, o));
      
      // orders í…Œì´ë¸”ì˜ delivery ì£¼ë¬¸ì—ì„œ table_idë¡œ delivery_orders.id ë§¤í•‘ ìƒì„±
      // table_id = "DL" + delivery_orders.id í˜•ì‹
      const tableIdToOrderId = new Map();
      [...deliveryAllOrders].forEach((o: any) => {
        if (o.table_id && String(o.table_id).startsWith('DL')) {
          const deliveryMetaId = String(o.table_id).substring(2); // "DL" ì œê±°
          tableIdToOrderId.set(deliveryMetaId, o.id);
          console.log('ðŸš— [loadTogoOrders] table_id mapping:', o.table_id, '->', o.id);
        }
      });
      
      // delivery_orders í…Œì´ë¸”ì˜ ë©”íƒ€ë°ì´í„° ë³‘í•© (deliveryCompany, deliveryOrderNumber ë“±)
      const getOrderRowByAnyId = (raw: any): any | undefined => {
        if (raw == null || raw === '') return undefined;
        if (orderMap.has(raw)) return orderMap.get(raw);
        const n = Number(raw);
        if (Number.isFinite(n) && orderMap.has(n)) return orderMap.get(n);
        const s = String(raw);
        if (orderMap.has(s)) return orderMap.get(s);
        return undefined;
      };
      const parseDeliveryNumFromLabel = (label?: string | null): string => {
        const m = String(label || '').match(/#\s*([^\s#]+)/);
        return m ? String(m[1]).trim() : '';
      };
      deliveryMetaOrders.forEach((meta: any) => {
        // 1ìˆœìœ„: order_idë¡œ ë§¤ì¹­
        // 2ìˆœìœ„: table_idì—ì„œ ì¶”ì¶œí•œ ë§¤í•‘ìœ¼ë¡œ ë§¤ì¹­
        // 3ìˆœìœ„: meta.idë¡œ ì§ì ‘ ë§¤ì¹­
        const metaIdStr = String(meta.id);
        const mappedOrderId = tableIdToOrderId.get(metaIdStr);
        const matchId = meta.order_id || mappedOrderId || meta.id;
        let existing =
          getOrderRowByAnyId(matchId) ||
          (mappedOrderId != null && mappedOrderId !== '' ? getOrderRowByAnyId(mappedOrderId) : undefined);
        if (!existing) {
          const dl = `DL${metaIdStr}`;
          orderMap.forEach((o: any) => {
            if (existing) return;
            if (o && String(o.table_id || '').toUpperCase() === dl.toUpperCase()) {
              existing = o;
            }
          });
        }

        console.log('ðŸš— [loadTogoOrders] Matching meta:', meta.id, 'order_id:', meta.order_id, 'mappedOrderId:', mappedOrderId, 'matchId:', matchId, 'found:', !!existing);
        
        if (existing) {
          // ê¸°ì¡´ ì£¼ë¬¸ì— delivery ë©”íƒ€ë°ì´í„° ì¶”ê°€
          existing.deliveryCompany = meta.delivery_company || meta.deliveryCompany;
          {
            const dn = String(meta.delivery_order_number || meta.deliveryOrderNumber || '').trim();
            existing.deliveryOrderNumber =
              dn ||
              parseDeliveryNumFromLabel(meta.name) ||
              parseDeliveryNumFromLabel((existing as any).customer_name) ||
              parseDeliveryNumFromLabel((existing as any).customerName);
          }
          existing.readyTimeLabel = meta.ready_time_label || meta.readyTimeLabel || existing.readyTimeLabel;
          existing.prepTime = meta.prep_time || meta.prepTime;
          existing.fulfillment_mode = 'delivery';
          existing.fulfillment = 'delivery';
          existing.order_id = existing.id; // orders í…Œì´ë¸”ì˜ id ì €ìž¥
          existing.deliveryMetaId = meta.id; // delivery_orders í…Œì´ë¸”ì˜ id ì €ìž¥
          const posFromMeta = meta.pos_order_number ?? meta.posOrderNumber;
          if (posFromMeta != null && String(posFromMeta).trim() !== '') {
            existing.order_number = existing.order_number || posFromMeta;
            existing.pos_order_number = existing.pos_order_number || posFromMeta;
          }
          const metaKey = String(meta.id);
          if (metaKey && orderMap.has(metaKey)) {
            const slot = orderMap.get(metaKey);
            if (slot && slot !== existing) orderMap.delete(metaKey);
          }
        } else {
          // delivery_ordersì—ë§Œ ìžˆëŠ” ì£¼ë¬¸ (ì•„ì§ OK ì•ˆ ëˆ„ë¥¸ ì£¼ë¬¸)
          const posFromMeta = meta.pos_order_number ?? meta.posOrderNumber;
          orderMap.set(meta.id, {
            id: meta.id,
            order_id: meta.order_id || null, // orders í…Œì´ë¸”ê³¼ ì—°ê²°ëœ id
            deliveryMetaId: meta.id, // delivery_orders id
            type: 'Delivery',
            status: meta.status || 'pending',
            created_at: meta.created_at || meta.createdAt,
            customer_name: meta.name,
            deliveryCompany: meta.delivery_company || meta.deliveryCompany,
            deliveryOrderNumber: meta.delivery_order_number || meta.deliveryOrderNumber,
            ready_time: meta.ready_time_label || meta.readyTimeLabel,
            readyTimeLabel: meta.ready_time_label || meta.readyTimeLabel,
            fulfillment_mode: 'delivery',
            fulfillment: 'delivery',  // í•„í„°ë§ìš© ì¶”ê°€
            prepTime: meta.prep_time || meta.prepTime,
            order_number: posFromMeta != null && String(posFromMeta).trim() !== '' ? posFromMeta : null,
            pos_order_number: posFromMeta != null && String(posFromMeta).trim() !== '' ? posFromMeta : null,
          });
        }
      });
      
      const allOrders = Array.from(orderMap.values());
      
      // PICKED_UP ìƒíƒœë§Œ ì œì™¸ (Pickup Complete ëœ ê²ƒë§Œ ì œì™¸)
      const orders = allOrders.filter((o: any) => {
        const status = (o.status || '').toUpperCase();
        return !EXCLUDE_STATUSES.includes(status);
      });

      const getOrderRowFromMap = (oid: any): any | null => {
        if (oid == null || oid === '') return null;
        return orderMap.get(oid) ?? orderMap.get(Number(oid)) ?? orderMap.get(String(oid)) ?? null;
      };

      /** delivery_orders 전용 행 등 order_number가 비어 있을 때, order_id 또는 DL↔orders 매핑으로 POS 일일 번호 보강 */
      const resolveLinkedPosOrderNumber = (o: any): string | number | null => {
        const direct = o.order_number ?? o.pos_order_number ?? o.posOrderNumber;
        if (direct != null && direct !== '') return direct;
        const fromRow = (row: any) => {
          const v = row?.order_number ?? row?.pos_order_number ?? row?.posOrderNumber;
          return v != null && v !== '' ? v : null;
        };
        const byOid = fromRow(getOrderRowFromMap(o.order_id ?? o.orderId));
        if (byOid != null) return byOid;
        const dMeta =
          (o as any).deliveryMetaId ??
          (typeof o.table_id === 'string' && String(o.table_id).toUpperCase().startsWith('DL')
            ? String(o.table_id).substring(2)
            : null);
        if (dMeta != null && dMeta !== '') {
          const ordersTableId = tableIdToOrderId.get(String(dMeta));
          const byDl = fromRow(getOrderRowFromMap(ordersTableId));
          if (byDl != null) return byDl;
        }
        return null;
      };

      const mapped = orders.map((o: any, idx: number) => {
        const resolvedPosNumber = resolveLinkedPosOrderNumber(o);
        const parsedId = Number(o.id);
        const fallbackId = Number(o.order_number || o.orderId);
        const safeId = Number.isFinite(parsedId)
          ? parsedId
          : Number.isFinite(fallbackId)
          ? Number(fallbackId)
          : o.id != null && String(o.id).trim() !== ''
          ? String(o.id)
          : Date.now() + idx;
        const phoneValue = o.customer_phone || o.customerPhone || o.phone || '';
        const digitsOnly = String(phoneValue || '').replace(/\D/g, '');
        const nameValue = o.customer_name || o.customerName || o.name || '';
        const formattedName = formatNameForDisplay(nameValue);
        const sanitizedName = formattedName.trim().toLowerCase() === 'unknown' ? '' : formattedName;
        const createdRaw = o.created_at || o.createdAt || null;
        const createdDate = createdRaw ? new Date(createdRaw) : null;
        const pickupMinutesRaw = Number(
          o.pickup_minutes ?? o.pickupMinutes ?? o.ready_in_minutes ?? o.readyMinutes ?? 0
        );
        let readyTimeLabel = '';
        if (
          createdDate &&
          !Number.isNaN(createdDate.getTime()) &&
          Number.isFinite(pickupMinutesRaw) &&
          pickupMinutesRaw > 0
        ) {
          const readyDate = new Date(createdDate.getTime() + pickupMinutesRaw * 60000);
          readyTimeLabel = readyDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        } else if (o.ready_time || o.pickup_time) {
          readyTimeLabel = String(o.ready_time || o.pickup_time);
        }
        const fulfillmentRaw = (
          o.fulfillment_mode ??
          o.fulfillmentMode ??
          o.fulfillment ??
          o.togoFulfillment ??
          ''
        )
          .toString()
          .trim()
          .toLowerCase();
        const fulfillment =
          fulfillmentRaw === 'delivery'
            ? 'delivery'
            : fulfillmentRaw === 'online' || fulfillmentRaw === 'web' || fulfillmentRaw === 'qr'
            ? 'online'
            : fulfillmentRaw === 'togo' || fulfillmentRaw === 'pickup'
            ? 'togo'
            : null;
        const apiVirtualId = typeof o.virtual_table_id === 'string' ? o.virtual_table_id.trim() : '';
        const virtualChannel =
          fulfillment === 'delivery'
            ? ('delivery' as VirtualOrderChannel)
            : fulfillment === 'online'
            ? ('online' as VirtualOrderChannel)
            : normalizeVirtualOrderChannel(o.virtual_table_channel, 'togo');
        return {
          id: safeId,
          order_id: o.order_id || null, // orders í…Œì´ë¸”ì˜ ì‹¤ì œ id (delivery ì£¼ë¬¸ì—ì„œ items ì¡°íšŒìš©)
          type: fulfillment === 'delivery' ? 'Delivery' : fulfillment === 'online' ? 'Online' : 'Togo',
          order_number:
            resolvedPosNumber != null && resolvedPosNumber !== '' ? resolvedPosNumber : null,
          number: resolvedPosNumber || o.id,
          time: new Date(createdRaw || Date.now()).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          createdAt: createdRaw,
          phone: phoneValue,
          phoneRaw: digitsOnly,
          name: sanitizedName,
          status: o.status?.toLowerCase() || 'pending',
          serverId: o.server_id || o.serverId || null,
          serverName: o.server_name || o.serverName || '',
          fulfillment,
          total: Number(o.total || 0),
          readyTimeLabel: o.readyTimeLabel || readyTimeLabel,
          virtualTableId: apiVirtualId || null,
          virtualChannel,
          // Delivery ì „ìš© í•„ë“œ (SQLite `channel` 슬러그 — orderListGetDeliveryMeta에서 배지용으로 매핑)
          channel: o.channel != null && String(o.channel).trim() !== '' ? String(o.channel).trim() : null,
          deliveryCompany: o.deliveryCompany || o.delivery_company || '',
          deliveryOrderNumber: (() => {
            const raw = String(o.deliveryOrderNumber || o.delivery_order_number || '').trim();
            if (raw) return raw;
            if (fulfillment === 'delivery') {
              return (
                parseDeliveryNumFromLabel(o.name) ||
                parseDeliveryNumFromLabel(o.customer_name) ||
                parseDeliveryNumFromLabel(o.customerName)
              );
            }
            return '';
          })(),
          deliveryMetaId:
            (o as any).deliveryMetaId ||
            ((typeof (o as any).table_id === 'string' && String((o as any).table_id).toUpperCase().startsWith('DL'))
              ? String((o as any).table_id).substring(2)
              : null),
          prepTime: o.prepTime || o.prep_time || 0,
          onlineOrderNumber: o.onlineOrderNumber || o.online_order_number || '',
          external_order_number: o.external_order_number != null && String(o.external_order_number).trim() !== ''
            ? String(o.external_order_number).trim()
            : null,
          firebase_order_id: o.firebase_order_id || o.firebaseOrderId || null,
        };
      });
      setTogoOrderMeta((prevMeta) => {
        const metaSource = mapped.map((order: any) => ({
          id: order.id,
          channel: order.virtualChannel,
          virtualTableId: order.virtualTableId,
        }));
        const nextMeta = buildVirtualTableMeta(metaSource, prevMeta, 'togo');
        const sequencedOrders = assignDailySequenceNumbers(mapped as any, 'TOGO') as any[];
        const normalizedOrders = sequencedOrders.map((order: any) => {
          const metakey = String(order.id);
          const resolvedMeta = nextMeta[metakey];
          return {
            ...order,
            virtualTableId: order.virtualTableId || resolvedMeta?.virtualTableId || null,
            virtualChannel: order.virtualChannel || resolvedMeta?.channel || 'togo',
          };
        });
        
        // ë””ë²„ê·¸ ë¡œê·¸: ë”œë¦¬ë²„ë¦¬ ì£¼ë¬¸ í™•ì¸
        const deliveryOrders = normalizedOrders.filter((o: any) => 
          String(o.fulfillment || '').toLowerCase() === 'delivery' ||
          String(o.type || '').toLowerCase() === 'delivery' ||
          o.deliveryCompany
        );
        console.log('ðŸš— [loadTogoOrders] Final deliveryOrders:', deliveryOrders.length, deliveryOrders);
        
        const hiddenSwipe = swipeRemovedPanelIdsRef.current;
        // 온라인 큐와 동일: 응답에 일시적으로 없다고 숨김 키를 지우지 않음(좀비 부활 방지).
        const togoVisible = normalizedOrders.filter((o: any) => {
          if (hiddenSwipe.has(String(o.id))) return false;
          const dm = String((o as any).deliveryMetaId || '');
          if (dm && hiddenSwipe.has(dm)) return false;
          const oid = String((o as any).order_id || '');
          if (oid && hiddenSwipe.has(oid)) return false;
          const onum = String((o as any).onlineOrderNumber || '').trim();
          if (onum && hiddenSwipe.has(onum)) return false;
          const fid = String((o as any).firebase_order_id || (o as any).firebaseOrderId || '').trim();
          if (fid && hiddenSwipe.has(fid)) return false;
          return true;
        });

        const deliveryPanelKey = (o: any): string | null => {
          const f = String(o.fulfillment || o.fulfillment_mode || '').toLowerCase();
          const tid = String(o.table_id || '').toUpperCase();
          const typ = String(o.type || o.order_type || '').toLowerCase();
          const isDel =
            f === 'delivery' ||
            tid.startsWith('DL') ||
            typ === 'delivery' ||
            !!(o.deliveryCompany || o.delivery_company);
          if (!isDel) return null;
          const dm = String(o.deliveryMetaId || o.delivery_meta_id || '').trim();
          if (dm) return `dm:${dm}`;
          return `id:${String(o.id)}`;
        };
        const nextDelKeys = new Set<string>();
        for (const o of togoVisible) {
          const k = deliveryPanelKey(o);
          if (k) nextDelKeys.add(k);
        }
        if (!isFirstDeliveryPanelLoadRef.current) {
          const hasNewDelivery = Array.from(nextDelKeys).some((k) => !previousDeliveryPanelKeysRef.current.has(k));
          if (hasNewDelivery) playOnlineOrderSound();
        } else {
          isFirstDeliveryPanelLoadRef.current = false;
        }
        previousDeliveryPanelKeysRef.current = nextDelKeys;

        try {
          let orderSrvSynced = false;
          for (const order of togoVisible) {
            const oidRaw = (order as any).order_id != null && String((order as any).order_id).trim() !== ''
              ? (order as any).order_id
              : order.id;
            if (oidRaw == null || oidRaw === '') continue;
            const apiName = String((order as any).serverName || '').trim();
            const apiSid = (order as any).serverId;
            if (!apiName || apiSid == null || apiSid === '') continue;
            try {
              const cur = loadServerAssignment('order', oidRaw);
              if (!cur || cur.serverName !== apiName || String(cur.serverId) !== String(apiSid)) {
                saveServerAssignment('order', oidRaw, { serverId: String(apiSid), serverName: apiName });
                orderSrvSynced = true;
              }
            } catch {}
          }
          if (orderSrvSynced) window.dispatchEvent(new Event('posServerAssignmentUpdated'));
        } catch {}

        setTogoOrders(togoVisible);
        return nextMeta;
      });
    } catch (error) {
      console.warn('Failed to load togo orders:', error);
    }
  }, [API_URL, setTogoOrders, playOnlineOrderSound]);

  const openChannelOrder = useCallback(
    (channel: VirtualOrderChannel, order: any) => {
      const resolvedVirtualId =
        typeof order?.virtualTableId === 'string' && order.virtualTableId
          ? String(order.virtualTableId)
          : channel === 'togo'
          ? togoOrderMeta[String(order?.id)]?.virtualTableId || null
          : null;
      if (channel === 'togo') {
        navigate('/sales/order', {
          state: {
            orderType: 'togo',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            orderId: order.id,
            serverId: order.serverId,
            serverName: order.serverName,
            customerName: order.name,
            customerPhone: order.phone,
            readyTimeLabel: order.readyTimeLabel,
            pickup: order.pickup || null,
            togoFulfillment: order.fulfillment || order.type || null,
            virtualTableId: resolvedVirtualId,
            virtualTableChannel: 'togo',
          },
        });
        return;
      }
      if (channel === 'online') {
        navigate('/sales/order', {
          state: {
            orderType: 'online',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            orderId: order.id,
            customerName: order.name || order.customerName,
            customerPhone: order.phone || order.customerPhone,
            virtualTableId: resolvedVirtualId || order.virtualTableId || null,
            readyTimeLabel: order.readyTimeLabel || (order.fullOrder || order)?.readyTimeLabel || '',
            pickup: order.pickup || (order.fullOrder || order)?.pickup || null,
            virtualTableChannel: 'online',
            onlineOrder: order.fullOrder || order, // ì „ì²´ ì£¼ë¬¸ ë°ì´í„° ì „ë‹¬
          },
        });
      }
    },
    [defaultMenu.menuId, defaultMenu.menuName, navigate, togoOrderMeta]
  );

  const handleBackToOrderFromDetailModal = useCallback(
    (order: OrderData, orderType: OrderChannelType) => {
      if (!order) return;
      const resolvedOrderId =
        orderType === 'delivery'
          ? ((order as any).order_id ?? (order as any).fullOrder?.order_id ?? order.id)
          : orderType === 'online'
          ? (order.localOrderId ?? (order as any).fullOrder?.localOrderId ?? (order as any).order_id ?? order.id)
          : order.id;

      if (!resolvedOrderId) {
        alert('Invalid order.');
        return;
      }

      const customerName =
        order.name ||
        order.customerName ||
        (order as any).fullOrder?.customer_name ||
        (order as any).fullOrder?.customerName ||
        '';
      const customerPhone =
        order.phone ||
        order.customerPhone ||
        (order as any).fullOrder?.customer_phone ||
        (order as any).fullOrder?.customerPhone ||
        '';
      const readyTimeLabel =
        (order.readyTimeLabel as any) ||
        (order as any).fullOrder?.ready_time ||
        (order as any).fullOrder?.readyTime ||
        '';
      const pickup = (order as any).pickup || null;
      const togoFulfillment =
        (order as any).fulfillment ||
        (order as any).type ||
        (orderType === 'delivery' ? 'delivery' : null);

      const orderTypeForOrderPage =
        orderType === 'togo' || orderType === 'pickup'
          ? 'togo'
          : orderType === 'online'
          ? 'online'
          : 'togo';

      navigate('/sales/order', {
        state: {
          orderType: orderTypeForOrderPage,
          menuId: defaultMenu.menuId,
          menuName: defaultMenu.menuName,
          orderId: resolvedOrderId,
          customerName,
          customerPhone,
          readyTimeLabel,
          pickup,
          togoFulfillment,
        },
      });

      setShowOrderDetailModal(false);
      setSelectedOrderDetail(null);
      setSelectedOrderType(null);
    },
    [defaultMenu.menuId, defaultMenu.menuName, navigate]
  );

  const handleVirtualOrderCardClick = useCallback(
    async (channel: VirtualOrderChannel, order: any) => {
      console.log('[handleVirtualOrderCardClick] Called:', { channel, orderId: order?.id, isMoveMergeMode, sourceTableId, sourceTogoOrder, selectionChoice });
      
      // Move/Merge ëª¨ë“œì¼ ë•Œ
      if (isMoveMergeMode) {
        // 1. í…Œì´ë¸” → Togo ë¨¸ì§€ (sourceTableIdê°€ ì„¤ì •ë¨)
        if (sourceTableId && selectionChoice) {
          console.log('[handleVirtualOrderCardClick] Table to Togo merge');
          const targetLabel = channel === 'togo' 
            ? `Togo #${order.id}` 
            : `Online #${order.number ?? order.id}`;
          
          try {
            setMoveMergeStatus(`🔄 Merging to ${targetLabel}...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromTableId: sourceTableId,
                toOrderId: order.id,
                toChannel: channel,
                floor: selectedFloor,
                partialSelection: selectionChoice && selectionChoice !== 'ALL'
                  ? {
                      guestNumbers: (selectionChoice as PartialSelectionPayload).guestNumbers || [],
                      orderItemIds: (selectionChoice as PartialSelectionPayload).orderItemIds || [],
                      orderLineIds: (selectionChoice as PartialSelectionPayload).orderLineIds || [],
                    }
                  : null,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              const isPartial = selectionChoice && selectionChoice !== 'ALL';
              const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Available');
              
              setTableElements(prev => prev.map(el => {
                if (String(el.id) === String(sourceTableId)) {
                  const next = { ...el, status: fromStatus };
                  if (fromStatus !== 'Occupied') {
                    next.current_order_id = null;
                  }
                  return next;
                }
                return el;
              }));
              
              setSourceTableId(null);
              setIsMoveMergeMode(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `âœ… Merged to ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTableId(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            console.error('Merge to Togo error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceTableId(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 2. Togo → Togo ë¨¸ì§€ (sourceTogoOrderê°€ ì„¤ì •ë¨)
        if (sourceTogoOrder) {
          // ê°™ì€ Togo ì„ íƒ ë°©ì§€
          if (sourceTogoOrder.id === order.id) {
            setMoveMergeStatus('âŒ Cannot select the same Togo.');
            setTimeout(() => setMoveMergeStatus('âœ“ Select destination Togo'), 1500);
            return;
          }
          
          // ë”ë¸” í´ë¦­ ë°©ì§€
          if (isMergeInProgress) {
            console.log('[handleVirtualOrderCardClick] Merge already in progress, ignoring');
            return;
          }
          
          console.log('[handleVirtualOrderCardClick] Togo to Togo merge');
          const sourceLabel = `Togo #${sourceTogoOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${targetLabel}...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-togo-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromOrderId: sourceTogoOrder.id,
                toOrderId: order.id,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              setSourceTogoOrder(null);
              setIsMoveMergeMode(false);
              setIsMergeInProgress(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `âœ… Merged ${sourceLabel} → ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setIsMergeInProgress(false);
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTogoOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            setIsMergeInProgress(false);
            console.error('Togo to Togo merge error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceTogoOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 3. Online → Togo ë¨¸ì§€ (sourceOnlineOrderê°€ ì„¤ì •ë¨)
        if (sourceOnlineOrder && channel === 'togo') {
          // ë”ë¸” í´ë¦­ ë°©ì§€
          if (isMergeInProgress) {
            console.log('[handleVirtualOrderCardClick] Merge already in progress, ignoring');
            return;
          }
          
          console.log('[handleVirtualOrderCardClick] Online to Togo merge');
          const sourceLabel = `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          // Online ì£¼ë¬¸ì€ localOrderId (SQLite ID) ì‚¬ìš©
          // ìš°ì„ ìˆœìœ„: localOrderId > fullOrder.localOrderId > number (ìˆ«ìžì¸ ê²½ìš°) > id
          const sourceOrderId = sourceOnlineOrder.localOrderId || 
            sourceOnlineOrder.fullOrder?.localOrderId || 
            (typeof sourceOnlineOrder.number === 'number' ? sourceOnlineOrder.number : null) ||
            sourceOnlineOrder.id;
          
          console.log('[handleVirtualOrderCardClick] Online sourceOrderId:', sourceOrderId,
            'localOrderId:', sourceOnlineOrder.localOrderId,
            'fullOrder.localOrderId:', sourceOnlineOrder.fullOrder?.localOrderId);
          
          try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${targetLabel}...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-togo-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromOrderId: sourceOrderId,
                toOrderId: order.id,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              setSourceOnlineOrder(null);
              setIsMoveMergeMode(false);
              setIsMergeInProgress(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              loadOnlineOrders(); // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ ìƒˆë¡œê³ ì¹¨
              
              setMoveMergeStatus(result.message || `âœ… Merged ${sourceLabel} → ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setIsMergeInProgress(false);
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceOnlineOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            setIsMergeInProgress(false);
            console.error('Online to Togo merge error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceOnlineOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 4. ì¶œë°œ ì„ íƒ (sourceTableId, sourceTogoOrder, sourceOnlineOrder ëª¨ë‘ ì—†ëŠ” ê²½ìš°)
        if (!sourceTableId && !sourceTogoOrder && !sourceOnlineOrder) {
          if (channel === 'togo') {
            const sourceLabel = `Togo #${order.id}`;
            setSourceTogoOrder(order);
            setMoveMergeStatus(`âœ“ Source: ${sourceLabel} → Select destination Togo`);
          } else if (channel === 'online') {
            const sourceLabel = `Online #${order.number ?? order.id}`;
            setSourceOnlineOrder(order);
            setMoveMergeStatus(`âœ“ Source: ${sourceLabel} → Select destination Togo`);
          }
          return;
        }
      }
      
      // Move/Merge ëª¨ë“œê°€ ì•„ë‹ ë•Œ: ëª¨ë‹¬ ì—´ê¸°
      // Togo ë˜ëŠ” Delivery ì£¼ë¬¸ì¸ ê²½ìš° ìƒì„¸ ì •ë³´(items) ê°€ì ¸ì˜¤ê¸°
      if ((channel === 'togo' || channel === 'delivery') && order.id) {
        try {
          // Delivery ì£¼ë¬¸ì€ order_id ì‚¬ìš©
          const actualOrderId = channel === 'delivery' ? (order.order_id || order.id) : order.id;
          const res = await fetch(`${API_URL}/orders/${actualOrderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.items) {
              // fullOrder í˜•íƒœë¡œ ë³€í™˜í•˜ì—¬ ì €ìž¥
              const parsedItems = data.items.map((item: any) => {
                let options: any[] = [];
                let totalModifierPrice = 0;
                try {
                  if (item.modifiers_json) {
                    const mods = typeof item.modifiers_json === 'string' 
                      ? JSON.parse(item.modifiers_json) 
                      : item.modifiers_json;
                    options = Array.isArray(mods) ? mods : [];
                    // Calculate totalModifierPrice
                    options.forEach((modGroup: any) => {
                      if (modGroup.totalModifierPrice) {
                        totalModifierPrice += Number(modGroup.totalModifierPrice);
                      } else if (modGroup.selectedEntries) {
                        modGroup.selectedEntries.forEach((entry: any) => {
                          totalModifierPrice += Number(entry.price_delta || entry.price || 0);
                        });
                      }
                    });
                  }
                } catch {}
                return {
                  ...item,
                  name: item.name,
                  quantity: item.quantity || 1,
                  price: item.price || 0,
                  options,
                  totalModifierPrice,
                  taxDetails: item.taxDetails || []
                };
              });
              // DB subtotal ì‚¬ìš©, ì—†ìœ¼ë©´ ì•„ì´í…œ í•©ê³„ë¡œ ê³„ì‚°
              const calculatedSubtotal = parsedItems.reduce((sum: number, item: any) => 
                sum + ((item.price + (item.totalModifierPrice || 0)) * item.quantity), 0);
              
              const fullOrder = {
                ...order,
                status: data.order?.status || order.status,
                paymentStatus: data.order?.paymentStatus || order.paymentStatus,
                items: parsedItems,
                adjustments: Array.isArray((data as any)?.adjustments) ? (data as any).adjustments : [],
                subtotal: data.order?.subtotal || calculatedSubtotal,
                tax: data.order?.tax || 0,
                taxBreakdown: data.order?.tax_breakdown ? JSON.parse(data.order.tax_breakdown) : null,
                total: data.order?.total || order.total || 0
              };
              setCardDetailOrder({ ...order, fullOrder, subtotal: data.order?.subtotal || calculatedSubtotal, tax: data.order?.tax || 0, total: data.order?.total || order.total || 0 });
              setCardDetailItems(parsedItems);
              setCardDetailChannel(channel);
              setShowCardDetailModal(true);
              return;
            }
          }
        } catch (e) {
          console.warn(`Failed to load ${channel} order details:`, e);
        }
      }
      if (channel === 'online' && order.fullOrder?.items) {
        setCardDetailOrder(order);
        setCardDetailItems(order.fullOrder.items);
        setCardDetailChannel(channel);
        setShowCardDetailModal(true);
      } else {
        setCardDetailOrder(order);
        setCardDetailItems([]);
        setCardDetailChannel(channel);
        setShowCardDetailModal(true);
        const actualOrderId = channel === 'delivery'
          ? (order.order_id || order.id)
          : (order.localOrderId || order.fullOrder?.localOrderId || order.order_id || order.id);
        if (actualOrderId) {
          try {
            const res = await fetch(`${API_URL}/orders/${actualOrderId}`);
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.items) {
                setCardDetailItems(data.items);
                setCardDetailOrder((prev: any) => {
                  if (!prev) return prev;
                  const parsed = Array.isArray(data.items) ? data.items : [];
                  const calcSub = parsed.reduce((sum: number, item: any) => {
                    const p = Number(item.price || item.total_price || 0);
                    const q = item.quantity || 1;
                    const mp = Number(item.totalModifierPrice || 0);
                    return sum + (p + mp) * q;
                  }, 0);
                  const oSub = data.order?.subtotal != null ? Number(data.order.subtotal) : NaN;
                  const oTax = data.order?.tax != null ? Number(data.order.tax) : NaN;
                  const oTot = data.order?.total != null ? Number(data.order.total) : NaN;
                  const subtotal = Number.isFinite(oSub) && oSub > 0.0001 ? oSub : calcSub;
                  const prevTot = Number(prev.total ?? prev.fullOrder?.total ?? 0);
                  const total =
                    Number.isFinite(oTot) && oTot > 0.0001
                      ? oTot
                      : prevTot > 0.0001
                        ? prevTot
                        : subtotal;
                  let tax = Number.isFinite(oTax) ? oTax : NaN;
                  if (!Number.isFinite(tax) || tax < 0) {
                    tax = Math.max(0, Number((total - subtotal).toFixed(2)));
                  }
                  return { ...prev, subtotal, tax, total };
                });
              }
            }
          } catch {}
        }
      }
    },
    [isMoveMergeMode, sourceTableId, sourceTogoOrder, sourceOnlineOrder, selectionChoice, selectedFloor, loadTogoOrders, clearMoveMergeSelection, API_URL]
  );
  useEffect(() => {
    setTogoOrderMeta((prev) => {
      const activeKeys = new Set(
        Object.values(virtualOrderLookup).map((entry) => entry.orderId)
      );
      let mutated = false;
      const retained: Record<string, VirtualOrderMeta> = {};
      Object.keys(prev).forEach((key) => {
        if (activeKeys.has(key)) {
          retained[key] = prev[key];
        } else {
          mutated = true;
        }
      });
      return mutated ? retained : prev;
    });
  }, [virtualOrderLookup]);

  const buildCustomerSuggestionOrders = useCallback(
    (predicate: (order: any) => boolean) => {
      const buckets = new Map<string, any[]>();
      togoOrders.forEach((order) => {
        if (!predicate(order)) return;
        // ë‹¤ì–‘í•œ í•„ë“œëª… ì§€ì› (customer_phone, customerPhone, phoneRaw, phone)
        const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
        const phoneKey = normalizePhoneDigits(rawPhone);
        const nameValue = order.customer_name || order.customerName || order.name || '';
        const key = phoneKey || nameValue.toLowerCase().trim();
        if (!key) return;
        const existing = buckets.get(key) || [];
        existing.push(order);
        buckets.set(key, existing);
      });
      const suggestions: CustomerSuggestion[] = [];
      buckets.forEach((orders, key) => {
        const sorted = [...orders].sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));
        const primary = sorted[0] || {};
        const primaryPhone = primary.customer_phone || primary.customerPhone || primary.phoneRaw || primary.phone || '';
        const primaryName = primary.customer_name || primary.customerName || primary.name || '';
        suggestions.push({
          key,
          name: sanitizeDisplayName(primaryName),
          phone: primaryPhone,
          phoneRaw: normalizePhoneDigits(primaryPhone),
          orders: sorted.slice(0, 5),
        });
      });
      suggestions.sort((a, b) => {
        const aTs = getOrderTimestamp(a.orders[0] || {});
        const bTs = getOrderTimestamp(b.orders[0] || {});
        return bTs - aTs;
      });
      return suggestions.slice(0, 5);
    },
    [togoOrders, getOrderTimestamp]
  );

  const buildRemoteSuggestions = useCallback(
    (orders: any[]): CustomerSuggestion[] => {
      const buckets = new Map<string, CustomerSuggestion>();
      orders.forEach((order) => {
        const rawPhone = order.customer_phone || order.customerPhone || order.phone || '';
        const digits = normalizePhoneDigits(rawPhone || '');
        const nameSource = order.customer_name || order.customerName || order.name || '';
        const key = digits || (nameSource || '').toLowerCase().trim();
        if (!key) return;
        const displayName = sanitizeDisplayName(nameSource);
        const displayPhone = digits ? formatTogoPhone(digits) : rawPhone;
        const normalizedOrder = {
          ...order,
          phone: rawPhone,
          phoneRaw: digits,
        };
        const existing = buckets.get(key);
        if (existing) {
          const merged = [...existing.orders];
          if (!merged.some((item: any) => String(item.id) === String(order.id))) {
            merged.push(normalizedOrder);
            merged.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
            if (merged.length > 5) {
              merged.length = 5;
            }
          }
          buckets.set(key, { ...existing, orders: merged });
        } else {
          buckets.set(key, {
            key,
            name: displayName,
            phone: displayPhone,
            phoneRaw: digits,
            orders: [normalizedOrder],
          });
        }
      });
      return Array.from(buckets.values()).sort(
        (a, b) => getOrderTimestamp(b.orders[0] || {}) - getOrderTimestamp(a.orders[0] || {})
      );
    },
    [getOrderTimestamp]
  );

  const historyInsights = useMemo(() => {
    if (!historyOrderDetail || !historyOrderDetail.order) return null;
    const order = historyOrderDetail.order;
    const items = Array.isArray(historyOrderDetail.items) ? historyOrderDetail.items : [];
    const adjustments = Array.isArray(historyOrderDetail.adjustments) ? historyOrderDetail.adjustments : [];
    const previousTotal = Number(getOrderTotalValue(order) || 0);

    let priceInsight: null | {
      previousTotal: number;
      estimatedCurrent?: number;
      diff?: number;
      direction?: 'up' | 'down' | 'same';
      hasMenuData: boolean;
    } = null;

    if (items.length > 0) {
      if (currentMenuPriceMap) {
        let estimatedCurrent = 0;
        items.forEach((item: any) => {
          const qty = Number(item.quantity || item.qty || 1);
          const basePrice = Number(item.price || item.unit_price || 0);
          const lookupKey = item.item_id ?? item.itemId ?? item.id;
          const menuPrice = lookupKey != null ? currentMenuPriceMap.get(String(lookupKey)) : undefined;
          const currentUnitPrice = Number.isFinite(menuPrice as number) ? (menuPrice as number) : basePrice;
          estimatedCurrent += currentUnitPrice * qty;
        });
        estimatedCurrent = Number(estimatedCurrent.toFixed(2));
        const diff = Number((estimatedCurrent - previousTotal).toFixed(2));
        let direction: 'up' | 'down' | 'same' = 'same';
        if (Math.abs(diff) >= 0.01) {
          direction = diff > 0 ? 'up' : 'down';
        }
        priceInsight = {
          previousTotal: Number(previousTotal.toFixed(2)),
          estimatedCurrent,
          diff,
          direction,
          hasMenuData: true,
        };
      } else {
        priceInsight = { previousTotal: Number(previousTotal.toFixed(2)), hasMenuData: false };
      }
    }

    const promoAdjustments = adjustments.filter(
      (adj: any) => String(adj?.kind || '').toUpperCase() === 'PROMOTION'
    );
    let promotionInsight: { message: string; tone: 'neutral' | 'info' } = { message: 'No changes', tone: 'neutral' };
    if (promoAdjustments.length > 0) {
      const names = Array.from(
        new Set(
          promoAdjustments
            .map((adj: any) => (adj?.label || 'Promotion').toString().trim())
            .filter(Boolean)
        )
      );
      const totalBenefit = promoAdjustments.reduce(
        (sum: number, adj: any) => sum + Math.abs(Number(adj?.amountApplied || 0)),
        0
      );
      const label = names.length ? names.join(', ') : 'Promotion';
      promotionInsight = {
        message: `${label} · -${formatCurrency(totalBenefit)}`,
        tone: 'info',
      };
    }

    return { price: priceInsight, promotion: promotionInsight };
  }, [historyOrderDetail, currentMenuPriceMap, getOrderTotalValue]);

  const priceChangeSummary = useMemo(() => {
    const neutral = { label: 'No change', tone: 'neutral' as 'neutral' | 'up' | 'down' };
    if (!historyInsights || !historyInsights.price) {
      return { label: 'No data', tone: 'neutral' as const };
    }
    const info = historyInsights.price;
    if (!info.hasMenuData) {
      return { label: 'No menu data', tone: 'neutral' as const };
    }
    if (!info.diff || Math.abs(info.diff) < 0.01) return neutral;
    const diffAbs = Math.abs(info.diff);
    const diffLabel = `${info.diff > 0 ? '+' : '-'}${formatCurrency(diffAbs)}`;
    return { label: diffLabel, tone: info.diff > 0 ? 'up' : 'down' };
  }, [historyInsights]);

  const promotionSummary = useMemo(() => {
    if (!historyInsights || !historyInsights.promotion) return '';
    const msg = historyInsights.promotion.message || '';
    if (!msg || msg === 'No changes' || msg === 'No promotion changes') return '';
    return msg;
  }, [historyInsights]);

  const mergeSuggestionLists = useCallback(
    (base: CustomerSuggestion[], additions: CustomerSuggestion[]) => {
      if (!additions.length) return base;
      const map = new Map<string, CustomerSuggestion>();
      base.forEach((entry) => map.set(entry.key, entry));
      additions.forEach((entry) => {
        if (map.has(entry.key)) {
          const existing = map.get(entry.key)!;
          const combined = [...existing.orders];
          entry.orders.forEach((ord: any) => {
            if (!combined.some((o: any) => String(o.id) === String(ord.id))) {
              combined.push(ord);
            }
          });
          combined.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
          if (combined.length > 5) {
            combined.length = 5;
          }
          map.set(entry.key, { ...existing, orders: combined });
        } else {
          map.set(entry.key, entry);
        }
      });
      return Array.from(map.values());
    },
    [getOrderTimestamp]
  );
  const updateCustomerSuggestions = useCallback(
    (mode: 'phone' | 'name', rawValue: string) => {
      const value = rawValue.trim();
      if (!value) {
        customerSuggestionFetchIdRef.current += 1;
        clearCustomerSuggestions();
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      if (mode === 'phone') {
        const digits = getTogoPhoneDigits(value);
        // 1ìžë¦¬ë¶€í„° ê²€ìƒ‰ ì‹œìž‘
        if (digits.length < 1) {
          setCustomerSuggestions([]);
          setCustomerSuggestionSource(null);
          setSelectedCustomerHistory(null);
          resetCustomerHistoryView();
          return;
        }
        
        // ë¡œì»¬ ê²€ìƒ‰ (togoOrdersì—ì„œ) - ë™ê¸°ì ìœ¼ë¡œ ì²˜ë¦¬
        const localMatches = buildCustomerSuggestionOrders((order) => {
          const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
          const orderDigits = normalizePhoneDigits(rawPhone);
          return orderDigits.startsWith(digits);
        });
        
        // ê²°ê³¼ ì¦‰ì‹œ í‘œì‹œ
        setCustomerSuggestions(localMatches);
        setCustomerSuggestionSource(localMatches.length > 0 ? 'phone' : null);
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      const formattedName = formatNameForDisplay(value);
      const lowered = formattedName.toLowerCase();
      // ì´ë¦„ë„ 1ê¸€ìžë¶€í„° ê²€ìƒ‰ (ê¸°ì¡´ 2ê¸€ìž ì œí•œ í•´ì œ)
      if (lowered.replace(/\s+/g, '').length < 1) {
        customerSuggestionFetchIdRef.current += 1;
        clearCustomerSuggestions();
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      const localMatches = buildCustomerSuggestionOrders((order) => {
        // ë‹¤ì–‘í•œ í•„ë“œëª… ì§€ì› (customer_name, customerName, name)
        const nameValue = order.customer_name || order.customerName || order.name || '';
        const orderName = formatNameForDisplay(nameValue).toLowerCase();
        return orderName.includes(lowered);
      });
      setCustomerSuggestions(localMatches);
      setCustomerSuggestionSource(localMatches.length ? 'name' : null);
      setSelectedCustomerHistory(null);
      resetCustomerHistoryView();
      const fetchId = ++customerSuggestionFetchIdRef.current;
      (async () => {
        try {
          const params = new URLSearchParams();
          params.set('customerName', formattedName);
          params.set('limit', '50');
          const res = await fetch(`${API_URL}/orders?${params.toString()}`);
          if (!res.ok) throw new Error('Failed to load customer suggestions.');
          const data = await res.json();
          if (customerSuggestionFetchIdRef.current !== fetchId) return;
          const remote = buildRemoteSuggestions(Array.isArray(data.orders) ? data.orders : []);
          const merged = mergeSuggestionLists(localMatches, remote);
          setCustomerSuggestions(merged);
          setCustomerSuggestionSource(merged.length ? 'name' : null);
        } catch (error) {
          if (customerSuggestionFetchIdRef.current !== fetchId) return;
          console.warn('Failed to load customer suggestions:', error);
        }
      })();
    },
    [API_URL, buildCustomerSuggestionOrders, buildRemoteSuggestions, clearCustomerSuggestions, getTogoPhoneDigits, mergeSuggestionLists, resetCustomerHistoryView]
  );
  const handleSuggestionFocus = () => {
    if (suggestionHideTimeoutRef.current) {
      clearTimeout(suggestionHideTimeoutRef.current);
      suggestionHideTimeoutRef.current = null;
    }
  };
  const scheduleSuggestionHide = () => {
    // ë“œë¡­ë‹¤ìš´ ìˆ¨ê¸°ê¸° ë¹„í™œì„±í™” - ì‚¬ìš©ìžê°€ ì„ íƒí•˜ê±°ë‚˜ ëª¨ë‹¬ ë‹«ì„ ë•Œë§Œ ìˆ¨ê¹€
    // if (suggestionHideTimeoutRef.current) {
    //   clearTimeout(suggestionHideTimeoutRef.current);
    // }
    // suggestionHideTimeoutRef.current = setTimeout(() => {
    //   clearCustomerSuggestions();
    // }, 120);
  };
  const handleCustomerSuggestionSelect = (suggestion: CustomerSuggestion) => {
    if (suggestionHideTimeoutRef.current) {
      clearTimeout(suggestionHideTimeoutRef.current);
      suggestionHideTimeoutRef.current = null;
    }
    historyFetchIdRef.current += 1;
    setCustomerHistoryOrders([]);
    setCustomerHistoryError('');
    setCustomerHistoryLoading(false);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    setCustomerPhone(formatTogoPhone(suggestion.phone));
    setCustomerName(sanitizeDisplayName(suggestion.name));
    setSelectedCustomerHistory(suggestion);
    setCustomerSuggestionSource(null);
    setCustomerSuggestions([]);
  };
  // placeholder to maintain ordering
  // ì „í™”ë²ˆí˜¸ ìž…ë ¥ ì‹œ ë¬´ì¡°ê±´ ì¼ì¹˜í•˜ëŠ” ê³ ê° í‘œì‹œ
  const renderCustomerSuggestionList = (source: 'phone' | 'name') => {
    // ê°„ë‹¨í•˜ê²Œ: ê²°ê³¼ê°€ ìžˆìœ¼ë©´ ë¬´ì¡°ê±´ í‘œì‹œ
    if (customerSuggestions.length === 0) return null;
    if (source === 'name' && customerSuggestionSource === 'phone') return null;
    if (source === 'phone' && customerSuggestionSource === 'name') return null;
    
    return (
      <div 
        className="absolute left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-2xl max-h-60 overflow-y-auto"
        style={{ zIndex: 99999, top: '100%' }}
      >
        {customerSuggestions.map((suggestion) => (
          <button
            type="button"
            key={`${source}-${suggestion.key}`}
            className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
            onMouseDown={(event) => {
              event.preventDefault();
              handleCustomerSuggestionSelect(suggestion);
            }}
          >
            <div className="text-base font-semibold text-slate-800">{suggestion.name || '\u00A0'}</div>
            <div className="text-sm text-slate-500">{suggestion.phone}</div>
          </button>
        ))}
      </div>
    );
  };
  const readyTimeSnapshot = useMemo(() => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + pickupTime;
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    const ready24 = `${readyHours.toString().padStart(2, '0')}:${readyMinutes.toString().padStart(2, '0')}`;
    // Display as 12-hour time (e.g. 08:00 PM) per UI requirement.
    const readyDisplay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const currentDisplay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return { current: formatMinutesToTime(now.getHours() * 60 + now.getMinutes()), ready: ready24, readyDisplay, currentDisplay };
  }, [pickupTime]);

  const computeReadyDisplayFromNow = (prepMinutes: number) => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + Math.max(0, Number(prepMinutes || 0));
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatHHMM = (hh: number, mm: number) => {
    const h = Math.max(0, Math.min(23, Number(hh)));
    const m = Math.max(0, Math.min(59, Number(mm)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const normalizeReadyTimeForPrint = (raw: any) => {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (!s) return '';
    const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    // If it's a plain HH:MM (manual clock input), treat it as the specified time.
    if (m && !m[3]) return formatHHMM(parseInt(m[1], 10), parseInt(m[2], 10));
    // Otherwise try to parse as a Date/ISO string; if that fails, use raw string.
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return s;
  };

  const applyTogoClockIfProvided = useCallback(() => {
    try {
      if (prepButtonsLocked) return null;
      const hh = parseInt(String(togoReadyHour || ''), 10);
      const mm = parseInt(String(togoReadyMinute || ''), 10);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

      const now = new Date();
      const target = new Date(now);
      target.setSeconds(0, 0);
      target.setHours(Math.max(0, Math.min(23, hh)), Math.max(0, Math.min(59, mm)), 0, 0);
      if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
      const minutes = Math.max(0, Math.min(1440, Math.round((target.getTime() - now.getTime()) / 60000)));

      const ampm: 'AM' | 'PM' = target.getHours() >= 12 ? 'PM' : 'AM';
      const dateLabel = formatPickupDateLabel(target);
      // Manual HH:MM input means "specified pickup time" -> store/print exactly HH:MM.
      const readyDisplay = formatHHMM(hh, mm);

      // Mirror the old "Set" behavior so OK/Reorder implicitly applies it.
      setPickupTime(minutes);
      setPickupAmPm(ampm);
      setPickupDateLabel(dateLabel);

      return { minutes, ampm, dateLabel, readyDisplay, target };
    } catch {
      return null;
    }
  }, [prepButtonsLocked, togoReadyHour, togoReadyMinute, formatPickupDateLabel]);

  const computeDeliveryReadyDisplay = (prepMinutes: number) => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + Math.max(0, Number(prepMinutes || 0));
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const computeDeliveryReadyLabel = (prepMinutes: number) => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + Math.max(0, Number(prepMinutes || 0));
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const applyDeliveryClockIfProvided = useCallback(() => {
    try {
      const hh = parseInt(String(deliveryReadyHour || ''), 10);
      const mm = parseInt(String(deliveryReadyMinute || ''), 10);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

      const now = new Date();
      const target = new Date(now);
      target.setSeconds(0, 0);
      target.setHours(Math.max(0, Math.min(23, hh)), Math.max(0, Math.min(59, mm)), 0, 0);
      if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
      const minutes = Math.max(0, Math.min(1440, Math.round((target.getTime() - now.getTime()) / 60000)));

      setDeliveryPrepTime(minutes);
      return { minutes, readyDisplay: computeDeliveryReadyDisplay(minutes), readyLabel: computeDeliveryReadyLabel(minutes) };
    } catch {
      return null;
    }
  }, [deliveryReadyHour, deliveryReadyMinute]);

  // Prefill clock inputs when modals open (do not overwrite while editing)
  useEffect(() => {
    if (!showTogoOrderModal) return;
    try {
      const d = new Date(Date.now() + Math.max(0, Number(pickupTime || 0)) * 60000);
      setTogoReadyHour(String(d.getHours()).padStart(2, '0'));
      setTogoReadyMinute(String(d.getMinutes()).padStart(2, '0'));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTogoOrderModal]);

  useEffect(() => {
    if (!showDeliveryOrderModal) return;
    try {
      const d = new Date(Date.now() + Math.max(0, Number(deliveryPrepTime || 0)) * 60000);
      setDeliveryReadyHour(String(d.getHours()).padStart(2, '0'));
      setDeliveryReadyMinute(String(d.getMinutes()).padStart(2, '0'));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeliveryOrderModal]);
  useEffect(() => {
    loadTogoOrders();
    const t = setInterval(loadTogoOrders, 10000);
    return () => clearInterval(t);
  }, [loadTogoOrders, refreshOrdersTrigger]);
  const handleReorderFromHistory = useCallback(async () => {
    if (reorderLoading) return;
    if (!selectedHistoryOrderId || !historyOrderDetail || !historyOrderDetail.order) {
      alert('Select an order to reorder.');
      return;
    }
    if (historyLoading) {
      alert('Order details are still loading. Please wait.');
      return;
    }
    if (!Array.isArray(historyOrderDetail.items) || historyOrderDetail.items.length === 0) {
      alert('No items available to reorder.');
      return;
    }
    if (shouldPromptServerSelection && !selectedTogoServer) {
      alert('Please select a server before reordering.');
      return;
    }
    try {
      setReorderLoading(true);
      const clockApplied = applyTogoClockIfProvided();
      const pickupMinutesForPayload = clockApplied?.minutes ?? pickupTime;
      const readyDisplayForPayload = clockApplied?.readyDisplay ?? computeReadyDisplayFromNow(pickupMinutesForPayload);
      const order = historyOrderDetail.order;
      const orderTypeRaw = (order.order_type || order.orderType || 'TOGO').toString().toUpperCase();
      const fulfillmentModeRaw =
        (
          order.fulfillment_mode ||
          order.fulfillmentMode ||
          order.fulfillment ||
          (orderTypeRaw === 'DELIVERY' ? 'delivery' : orderTypeRaw === 'TOGO' ? 'togo' : '')
        )
          ?.toString()
          .toLowerCase() || null;
      const now = new Date();
      const newOrderNumber = `REORDER-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate()
      ).padStart(2, '0')}-${now.getTime()}`;
      const itemsPayload = historyOrderDetail.items
        .map((item: any, idx: number) => {
          const modifiers = parseJsonSafe(item.modifiers_json ?? item.modifiersJson ?? item.modifiers, []);
          const memo = parseJsonSafe(item.memo_json ?? item.memoJson ?? item.memo, null);
          const discount = parseJsonSafe(item.discount_json ?? item.discountJson ?? item.discount, null);
          return {
            id: String(item.item_id ?? item.itemId ?? item.id ?? `history-${idx}`),
            name: item.name || `Item ${idx + 1}`,
            quantity: Number(item.quantity || 1),
            price: Number(item.price || 0),
            guestNumber: Number(item.guest_number || item.guestNumber || 1),
            modifiers: Array.isArray(modifiers) ? modifiers : [],
            memo: memo && typeof memo === 'object' ? memo : null,
            discount: discount && typeof discount === 'object' ? discount : null,
            splitDenominator: item.split_denominator || item.splitDenominator || null,
            orderLineId: String(item.order_line_id || item.orderLineId || `${Date.now()}-${idx}`),
          };
        })
        .filter((it) => Number(it.quantity) > 0);
      if (!itemsPayload.length) {
        alert('No items available to reorder.');
        setReorderLoading(false);
        return;
      }
      const adjustmentsPayload = Array.isArray(historyOrderDetail.adjustments)
        ? historyOrderDetail.adjustments.map((adj: any) => ({
            kind: String(adj.kind || ''),
            mode: adj.mode || '',
            value: Number(adj.value || 0),
            amountApplied: Number(adj.amountApplied ?? adj.amount_applied ?? 0),
            label: adj.label || null,
          }))
        : [];
      const phoneDigits = getTogoPhoneDigits(customerPhone || order.customer_phone || order.customerPhone || '');
      const customerPhoneForOrder = phoneDigits ? formatTogoPhone(phoneDigits) : (order.customer_phone || order.customerPhone || null);
      const customerNameForOrder =
        sanitizeDisplayName(customerName || order.customer_name || order.customerName || '') || null;
      const payload = {
        orderNumber: newOrderNumber,
        orderType: orderTypeRaw,
        total: Number(getOrderTotalValue(order) || 0),
        items: itemsPayload,
        adjustments: adjustmentsPayload,
        customerPhone: customerPhoneForOrder,
        customerName: customerNameForOrder,
        fulfillmentMode: fulfillmentModeRaw,
        readyTime: readyDisplayForPayload,
        pickupMinutes: pickupMinutesForPayload,
        serverId: selectedTogoServer?.employee_id || null,
        serverName: selectedTogoServer?.employee_name || null,
      };
      const response = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to process reorder.');
      const orderResult = await response.json();
      
      // Kitchen Ticket ì¶œë ¥ (Ticket for Take-out ë ˆì´ì•„ì›ƒ ì‚¬ìš©)
      try {
        const orderTypeForPrint = orderTypeRaw === 'DELIVERY' ? 'DELIVERY' : 'TOGO';
        // ì‹¤ì œ ì£¼ë¬¸ ë²ˆí˜¸ ì‚¬ìš© (#1043 í˜•ì‹)
        const actualOrderNumber = orderResult.orderId || orderResult.id || newOrderNumber;
        const actualOrderDisplayNumber = orderResult.order_number || actualOrderNumber;
        const printPayload = {
          orderInfo: {
            orderId: actualOrderNumber,
            orderNumber: `#${actualOrderDisplayNumber}`,
            orderType: orderTypeForPrint,
            channel: orderTypeForPrint,
            orderSource: orderTypeForPrint,
            readyTime: payload.readyTime,
            pickupTime: payload.readyTime,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
          },
          items: itemsPayload.map((item: any) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            modifiers: item.modifiers,
            memo: item.memo,
          })),
        };
        
        console.log('ðŸ–¨ï¸ [Reorder] Printing Kitchen Ticket:', printPayload);
        await printKitchenTicket(printPayload, 1);
      } catch (printError) {
        console.warn('Kitchen Ticket print failed (ignored):', printError);
      }
      
      await loadTogoOrders();
      resetTogoModalAfterAction();
    } catch (error: any) {
      console.error('Failed to reorder:', error);
      alert(error?.message || 'Failed to reorder. Please try again.');
    } finally {
      setReorderLoading(false);
    }
  }, [
    reorderLoading,
    selectedHistoryOrderId,
    historyOrderDetail,
    historyLoading,
    shouldPromptServerSelection,
    selectedTogoServer,
    customerPhone,
    customerName,
    pickupTime,
    applyTogoClockIfProvided,
    API_URL,
    getOrderTotalValue,
    loadTogoOrders,
    resetTogoModalAfterAction,
    formatTogoPhone,
    getTogoPhoneDigits,
    sanitizeDisplayName,
    parseJsonSafe,
  ]);
  const fetchClockedInServers = useCallback(async () => {
    setServerModalLoading(true);
    setServerModalError('');
    try {
      const employees = await clockInOutApi.getClockedInEmployees();
      const filtered = Array.isArray(employees)
        ? employees.filter((employee) => {
            const role = (employee.role || '').toString().toLowerCase();
            return role.includes('server') || role.includes('manager');
          })
        : [];
      setClockedInServers(filtered);
    } catch (error) {
      console.warn('Failed to load clocked-in employees:', error);
      setServerModalError(error instanceof Error ? error.message : 'Failed to load server list.');
    } finally {
      setServerModalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showServerSelectionModal) {
      fetchClockedInServers();
    }
  }, [showServerSelectionModal, fetchClockedInServers]);
  useEffect(() => {
    if (showTogoOrderModal) {
      setTogoKeyboardTarget('phone');
    } else {
      customerSuggestionFetchIdRef.current += 1;
      resetCustomerHistoryView();
      setHistoryDetailsMap({});
      setSelectedCustomerHistory(null);
      setCustomerSuggestions([]);
      setCustomerSuggestionSource(null);
    }
  }, [showTogoOrderModal, resetCustomerHistoryView]);
  useEffect(() => {
    if (!showTogoOrderModal) return;
    fetchCustomerHistoryForSelection(selectedCustomerHistory);
  }, [showTogoOrderModal, selectedCustomerHistory, fetchCustomerHistoryForSelection]);
  useEffect(() => {
    if (customerHistoryOrders.length === 0) {
      setSelectedHistoryOrderId(null);
      return;
    }
    setSelectedHistoryOrderId((prev) => {
      if (prev != null) {
        const exists = customerHistoryOrders.some((order) => normalizeOrderId(order.id) === prev);
        if (exists) return prev;
      }
      const firstId = normalizeOrderId(customerHistoryOrders[0]?.id);
      return firstId;
    });
  }, [customerHistoryOrders]);
  useEffect(() => {
    if (!showTogoOrderModal || !selectedHistoryOrderId) {
      if (!selectedHistoryOrderId) {
        setHistoryOrderDetail(null);
        setHistoryLoading(false);
      }
      return;
    }
    const cached = historyDetailsMap[selectedHistoryOrderId];
    if (cached) {
      setHistoryOrderDetail(cached);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    (async () => {
      try {
        const res = await fetch(`${API_URL}/orders/${encodeURIComponent(String(selectedHistoryOrderId))}`);
        if (!res.ok) throw new Error('Failed to load order history.');
        const data = await res.json();
        const payload: HistoryOrderDetailPayload = {
          order: data?.order || null,
          items: Array.isArray(data?.items) ? data.items : [],
          adjustments: Array.isArray(data?.adjustments) ? data.adjustments : [],
        };
        if (cancelled) return;
        setHistoryDetailsMap((prev) => ({ ...prev, [selectedHistoryOrderId]: payload }));
        setHistoryOrderDetail(payload);
      } catch (error: any) {
        if (cancelled) return;
        setHistoryError(error?.message || 'Failed to load order history.');
        setHistoryOrderDetail(null);
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHistoryOrderId, showTogoOrderModal, historyDetailsMap]);

  const startTogoOrderFlow = useCallback((server: ClockedInEmployee | null) => {
    setSelectedTogoServer(server);
    if (server?.employee_id && server?.employee_name) {
      try {
        saveServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID, {
          serverId: String(server.employee_id),
          serverName: String(server.employee_name),
        });
        window.dispatchEvent(new Event('posServerAssignmentUpdated'));
      } catch {}
    }
    setPickupTime(15);
    setPickupAmPm(getCurrentAmPm());
    setPickupDateLabel(formatPickupDateLabel());
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerZip('');
    setTogoNote('');
    setTogoOrderMode('togo');
    setPrepButtonsLocked(false);
    setSelectedHistoryOrderId(null);
    setHistoryDetailsMap({});
    setHistoryOrderDetail(null);
    setHistoryError('');

    if (togoInfoTiming === 'after') {
      const createdLocal = getLocalDatetimeString();
      const readyTimeLabel = computeReadyDisplayFromNow(15);
      const newOrder = {
        id: Date.now(),
        type: 'Togo',
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        createdAt: createdLocal,
        phone: '',
        phoneRaw: '',
        name: '',
        firstName: '',
        lastName: '',
        nameOrder: 'firstLast' as const,
        status: 'pending',
        serverId: server?.employee_id || null,
        serverName: server?.employee_name || '',
        address: '',
        zip: '',
        note: '',
        fulfillment: 'togo',
        pickup: { minutes: 15, ampm: getCurrentAmPm(), dateLabel: formatPickupDateLabel() },
        readyTimeLabel,
        virtualChannel: 'togo' as VirtualOrderChannel,
        virtualTableId: null as string | null,
        service_pattern: 'TAKEOUT',
      };
      const usedVirtualIds = new Set<string>();
      Object.values(togoOrderMeta).forEach((meta) => {
        if (meta?.virtualTableId) usedVirtualIds.add(meta.virtualTableId);
      });
      const provisionalVirtualId = allocateVirtualTableId('togo', usedVirtualIds);
      newOrder.virtualTableId = provisionalVirtualId;
      setTogoOrderMeta((prev) => ({
        ...prev,
        [String(newOrder.id)]: { virtualTableId: provisionalVirtualId, channel: 'togo' },
      }));
      setTogoOrders((prev) => assignDailySequenceNumbers([...prev, newOrder], 'TOGO'));
      navigate('/sales/order', {
        state: {
          orderType: 'togo',
          menuId: defaultMenu.menuId,
          menuName: defaultMenu.menuName,
          orderId: newOrder.id,
          serverId: server?.employee_id || null,
          serverName: server?.employee_name || '',
          togoFulfillment: 'togo',
          pickup: newOrder.pickup,
          togoInfoTiming: 'after',
        },
      });
      return;
    }

    setShowTogoOrderModal(true);
  }, [togoInfoTiming, togoOrderMeta, defaultMenu.menuId, defaultMenu.menuName, navigate]);

  const handleNewTogoClick = () => {
    if (isMoveMergeMode) {
      // Move/Merge ëª¨ë“œì¼ ë•ŒëŠ” 'New Togo'ë¥¼ íƒ€ê²Ÿìœ¼ë¡œ ì„ íƒí•  ìˆ˜ ì—†ë„ë¡ ë§‰ìŒ (ìš”ì²­ì‚¬í•­)
      setMoveMergeStatus('âŒ Cannot move to New Togo (Not supported)');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }

    setTogoOrderMode('togo');
    setServerModalError('');
    setCustomerZip('');
    setBistroPendingTableElement(null);
    if (shouldPromptServerSelection) {
      setSelectedTogoServer(null);
      setShowServerSelectionModal(true);
    } else {
      startTogoOrderFlow(null);
    }
  };

  const handleNewOnlineClick = () => {
    if (isMoveMergeMode) {
      setMoveMergeStatus('❌ Cannot create new Online order in Move/Merge mode');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    setPickupModalInitialMode('online');
    setShowFsrPickupModal(true);
  };

  const handleNewDeliveryClick = () => {
    if (isMoveMergeMode) {
      setMoveMergeStatus('âŒ Cannot create new Delivery in Move/Merge mode');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    // Delivery ì „ìš© ëª¨ë‹¬ ì—´ê¸°
    setDeliveryCompany('');
    setDeliveryOrderNumber('');
    setShowDeliveryOrderModal(true);
  };

  const registerSwipeRemovedPanelIds = (...keys: Array<string | number | null | undefined>) => {
    const s = swipeRemovedPanelIdsRef.current;
    keys.forEach((k) => {
      if (k == null || k === '') return;
      if (typeof k === 'number' && !Number.isFinite(k)) return;
      const t = String(k).trim();
      if (t !== '' && t !== 'NaN' && t !== 'undefined') s.add(t);
    });
  };

  const handleSwipeStart = (e: React.TouchEvent | React.MouseEvent, id: string, orderType: string) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const target = (e.currentTarget as HTMLElement);
    const cardWidth = target?.offsetWidth || 200;
    swipeDragRef.current = { id, startX: clientX, currentX: clientX, type: orderType, cardWidth };
    swipeDraggedRef.current = false;
    setSwipeDragState({ id, offsetX: 0 });
  };

  const handleSwipeMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!swipeDragRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const movedPx = Math.abs(clientX - swipeDragRef.current.startX);
    if (movedPx > 5) swipeDraggedRef.current = true;
    swipeDragRef.current.currentX = clientX;
    const deltaX = clientX - swipeDragRef.current.startX;
    const cw = swipeDragRef.current.cardWidth || 200;
    const clamped = Math.max(-cw, Math.min(cw, deltaX));
    setSwipeDragState({ id: swipeDragRef.current.id, offsetX: clamped });
  };

  const handleSwipeEnd = async () => {
    if (!swipeDragRef.current) return;
    const { id, startX, currentX, type: orderType, cardWidth } = swipeDragRef.current;
    const dx = currentX - startX;
    const amount = Math.abs(dx);
    swipeDragRef.current = null;
    setTimeout(() => { swipeDraggedRef.current = false; }, 50);

    const swipeThreshold =
      orderType === 'online' ? cardWidth * 0.45 : (cardWidth * 2) / 3;
    if (amount < swipeThreshold) {
      setSwipeDragState(null);
      return;
    }

    const dismissToRight = dx > 0;
    setSwipeDragState({ id, offsetX: dismissToRight ? cardWidth + 50 : -(cardWidth + 50), dismissing: true });
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      if (orderType === 'delivery') {
        const fromTogo = togoOrders.find((o) => String(o.id) === String(id));
        const fromOnline = onlineQueueCards.find(
          (c) => String(c.id) === String(id) && isRightPanelDeliveryOrder(c)
        );
        const order = fromTogo || fromOnline;
        if (!order) return;
        const fo = (order as any).fullOrder || {};
        const dSt = String(order.status || fo.status || '').toUpperCase();
        const dIsPickedUp = dSt === 'PICKED_UP';
        if (dIsPickedUp) return;
        /** 스와이프는 UI와 같이 허용됨 — 결제 전(UNPAID)도 목록에서 제거. SQLite PATCH는 `dReady`일 때만 */
        // UP 딜리버리 채널 주문은 수락 후 'confirmed' 상태 → 이것도 PICKED_UP 처리 대상
        const dIsPaid =
          dSt === 'PAID' || dSt === 'COMPLETED' || dSt === 'CLOSED' ||
          dSt === 'READY' || dSt === 'READY_FOR_PICKUP' || dSt === 'PREPARED' ||
          dSt === 'CONFIRMED' || dSt === 'ACKNOWLEDGED' || dSt === 'ACCEPTED';
        const dIsDeliveryChannel = isRightPanelDeliveryOrder(order);
        const dReady = dIsPaid || dIsDeliveryChannel;
        const actualOrderIdRaw =
          (order as any).order_id != null && String((order as any).order_id).trim() !== ''
            ? (order as any).order_id
            : fo.localOrderId ?? fo.order_id ?? (Number.isFinite(Number(order.id)) ? order.id : null);
        const actualOrderIdNum = Number(actualOrderIdRaw);
        if (dReady && Number.isFinite(actualOrderIdNum)) {
          await fetch(`${API_URL}/orders/${actualOrderIdNum}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PICKED_UP' }),
          });
        }
        const deliveryMetaId = (order as any).deliveryMetaId || (order as any).delivery_meta_id || null;
        if (
          dReady &&
          deliveryMetaId != null &&
          String(deliveryMetaId).trim() !== ''
        ) {
          try {
            await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(String(deliveryMetaId))}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          } catch {}
        }
        const firebaseOid = String(fo.id || (order as any).firebase_order_id || (order as any).firebaseOrderId || '').trim();
        const onlineNum = String((order as any).onlineOrderNumber || fo.onlineOrderNumber || fo.orderNumber || '').trim();
        registerSwipeRemovedPanelIds(
          id,
          order.id,
          (order as any).order_id,
          deliveryMetaId,
          Number.isFinite(actualOrderIdNum) ? actualOrderIdNum : actualOrderIdRaw,
          firebaseOid || null,
          onlineNum || null
        );
        setTogoOrders((prev) =>
          prev.filter(
            (o) =>
              String(o.id) !== String(id) && String((o as any).deliveryMetaId || '') !== String(deliveryMetaId || '')
          )
        );
        setOnlineQueueCards((prev) => prev.filter((c) => String(c.id) !== String(id)));
      } else if (orderType === 'online') {
        const card = onlineQueueCards.find(c => String(c.id) === String(id));
        if (card) {
          if (!onlineQueueCardIsPaidReady(card)) return;
          const fo = (card as any).fullOrder || {};
          const localOrderIdRaw =
            fo.localOrderId ??
            fo.order_id ??
            card.localOrderId ??
            card.number;
          const localOrderIdNum =
            localOrderIdRaw != null && String(localOrderIdRaw).trim() !== ''
              ? Number(localOrderIdRaw)
              : NaN;
          await fetch(`${API_URL}/online-orders/order/${id}/pickup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (Number.isFinite(localOrderIdNum)) {
            await fetch(`${API_URL}/orders/${localOrderIdNum}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          }
          registerSwipeRemovedPanelIds(
            id,
            card.id,
            card.localOrderId,
            (card as any).fullOrder?.localOrderId,
            (card as any).fullOrder?.id,
            (card as any).fullOrder?.order_id,
            Number.isFinite(localOrderIdNum) ? localOrderIdNum : null,
            (card as any).onlineOrderNumber
          );
          setOnlineQueueCards(prev => prev.filter(c => String(c.id) !== String(id)));
        } else {
          const panelOrder = togoOrders.find(o => String(o.id) === String(id));
          if (!panelOrder || orderListGetPickupChannel(panelOrder) !== 'online') return;
          if (!onlineQueueCardIsPaidReady(panelOrder)) return;
          const actualOrderId = panelOrder.order_id || panelOrder.id;
          if (Number.isFinite(Number(actualOrderId))) {
            await fetch(`${API_URL}/orders/${actualOrderId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          }
          const panelFirebaseOrderId =
            (panelOrder as any).fullOrder?.id ??
            (panelOrder as any).firebaseOrderId ??
            (panelOrder as any).firebase_order_id ??
            null;
          if (panelFirebaseOrderId != null && String(panelFirebaseOrderId).trim() !== '') {
            try {
              await fetch(
                `${API_URL}/online-orders/order/${encodeURIComponent(String(panelFirebaseOrderId))}/pickup`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' } }
              );
            } catch {}
          }
          registerSwipeRemovedPanelIds(
            id,
            panelOrder.id,
            panelOrder.order_id,
            actualOrderId,
            (panelOrder as any).localOrderId,
            (panelOrder as any).fullOrder?.localOrderId,
            (panelOrder as any).fullOrder?.id,
            (panelOrder as any).onlineOrderNumber,
            panelFirebaseOrderId
          );
          setTogoOrders(prev => prev.filter(o => String(o.id) !== String(id)));
        }
      } else if (orderType === 'togo') {
        const order = togoOrders.find(o => String(o.id) === String(id));
        if (!order) return;
        const tSt = String(order.status || order.fullOrder?.status || '').toUpperCase();
        const tReady =
          tSt === 'PAID' ||
          tSt === 'COMPLETED' ||
          tSt === 'CLOSED' ||
          tSt === 'READY' ||
          tSt === 'READY_FOR_PICKUP' ||
          tSt === 'PREPARED';
        if (!tReady) return;
        const actualOrderId = order.order_id || order.id;
        if (Number.isFinite(Number(actualOrderId))) {
          await fetch(`${API_URL}/orders/${actualOrderId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PICKED_UP' }),
          });
        }
        registerSwipeRemovedPanelIds(id, order.id, order.order_id, actualOrderId);
        setTogoOrders(prev => prev.filter(o => String(o.id) !== String(id)));
      }
      // 전체 loadTogoOrders/loadOnlineOrders 호출은 목록·가상테이블 메타를 전부 다시 만들어 투고 패널이 깜빡임.
      // 위에서 이미 로컬 state + swipeRemovedPanelIdsRef 로 반영했고, 주기 폴링(10s)·다른 이벤트에서 동기화됨.
      if (showOrderListModal) {
        fetchOrderList(orderListDate, orderListOpenMode);
      }
    } catch (err) {
      console.error('Swipe pickup error:', err);
    } finally {
      setSwipeDragState(null);
    }
  };

  const handleServerModalClose = () => {
    setShowServerSelectionModal(false);
    setSelectedTogoServer(null);
    setBistroPendingTableElement(null);
  };

  const handleServerSelectForTogo = (employee: ClockedInEmployee) => {
    if (!employee) return;
    setShowServerSelectionModal(false);
    startTogoOrderFlow(employee);
  };

  // ìš”ì†Œ í‘œì‹œ ì´ë¦„ ê²°ì • í•¨ìˆ˜ (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
  const getElementDisplayName = (element: TableElement) => {
    switch (element.type) {
      case 'rounded-rectangle':
      case 'circle':
      case 'bar':
      case 'room': {
        // ì €ìž¥ëœ ì´ë¦„ ìš°ì„  ì‚¬ìš©, ì—†ìœ¼ë©´ T/B/R{id}
        const raw = (element.text && String(element.text).trim()) ? String(element.text).trim() : '';
        const prefix = element.type === 'bar' ? 'B' : (element.type === 'room' ? 'R' : 'T');
        let displayName = raw || `${prefix}${element.id}`;
        
        // Occupied ë˜ëŠ” Payment Pending ìƒíƒœì¸ ê²½ìš° ì‹œê°„ í‘œì‹œ
        if ((element.status === 'Occupied' || element.status === 'Payment Pending') && tableOccupiedTimes[String(element.id)]) {
          const now = Date.now();
          const elapsed = Math.floor((now - tableOccupiedTimes[String(element.id)]) / 1000 / 60); // ë¶„ ë‹¨ìœ„
          const hours = Math.floor(elapsed / 60);
          const minutes = elapsed % 60;
          displayName += `\n${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          const occDetail = tableReservationDetails[String(element.id)];
          if (occDetail) {
            displayName += `\n${occDetail.name}${occDetail.partySize ? ` ${occDetail.partySize}p` : ''}`;
          }
        }
        // Hold ë˜ëŠ” Reserved ìƒíƒœì¸ ê²½ìš° ì˜ˆì•½ìž ì´ë¦„ í‘œì‹œ
        else if ((element.status === 'Hold' || element.status === 'Reserved') && tableReservationNames[String(element.id)]) {
          const detail = tableReservationDetails[String(element.id)];
          if (detail && (detail.time || detail.partySize)) {
            const timePart = detail.time ? detail.time.slice(0, 5) : '';
            const sizePart = detail.partySize ? `${detail.partySize}p` : '';
            displayName += `\n${detail.name}`;
            displayName += `\n${[timePart, sizePart].filter(Boolean).join(' ')}`;
          } else {
            displayName += `\n${tableReservationNames[String(element.id)]}`;
          }
        }
        // Available 등 비예약 상태에서는 reservationDetails가 localStorage에 남아 있어도 표시하지 않음 (결제 후 T4처럼 잔상 방지)
        else if (
          (element.status === 'Hold' || element.status === 'Reserved') &&
          !tableReservationNames[String(element.id)] &&
          tableReservationDetails[String(element.id)]
        ) {
          const fallbackDetail = tableReservationDetails[String(element.id)];
          const timePart = fallbackDetail.time ? fallbackDetail.time.slice(0, 5) : '';
          const sizePart = fallbackDetail.partySize ? `${fallbackDetail.partySize}p` : '';
          displayName += `\n${fallbackDetail.name}`;
          if (timePart || sizePart) {
            displayName += `\n${[timePart, sizePart].filter(Boolean).join(' ')}`;
          }
        }
        
        return displayName;
      }
      case 'entrance':
        return 'Entrance'; // ë²ˆí˜¸ ì—†ìŒ
      case 'counter':
        return 'Counter'; // ë²ˆí˜¸ ì—†ìŒ
      case 'washroom':
        return 'WashRoom'; // ë²ˆí˜¸ ì—†ìŒ
      case 'restroom':
        return 'Restroom'; // ë²ˆí˜¸ ì—†ìŒ
      case 'cook-area':
        return 'Cook'; // ë²ˆí˜¸ ì—†ìŒ
      case 'divider':
        return ''; // Dividerì—ëŠ” ì´ë¦„ì„ ë„£ì§€ ì•ŠìŒ
      case 'wall':
        return ''; // Wallì—ë„ ì´ë¦„ì„ ë„£ì§€ ì•ŠìŒ
      case 'other':
        return element.text ? String(element.text).trim() : ''; // ë²ˆí˜¸ ì—†ìŒ
      case 'floor-label':
        return element.text || 'Floor'; // ë²ˆí˜¸ ì—†ìŒ
      default:
        return 'Element'; // ë²ˆí˜¸ ì—†ìŒ
    }
  };

  const handleServerSelectionSelect = (employee: ClockedInEmployee) => {
    if (!employee) return;
    const pending = bistroPendingTableElement;
    if (isBistroSalesRoute && pending) {
      setShowServerSelectionModal(false);
      setSelectedTogoServer(employee);
      if (employee?.employee_id && employee?.employee_name) {
        try {
          saveServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID, {
            serverId: String(employee.employee_id),
            serverName: String(employee.employee_name),
          });
          window.dispatchEvent(new Event('posServerAssignmentUpdated'));
        } catch {
          /* ignore */
        }
      }
      const raw = getElementDisplayName(pending) || '';
      const firstLine = String(raw).split('\n')[0] || pending.text || String(pending.id);
      setBistroContainerModalId(String(pending.id));
      setBistroContainerTitle(firstLine);
      setBistroContainerModalOpen(true);
      setBistroPendingTableElement(null);
      return;
    }
    handleServerSelectForTogo(employee);
  };

  // ë°±ì—”ë“œì—ì„œ í…Œì´ë¸” ë§µ ë°ì´í„° ê°€ì ¸ì˜¤ê¸°
  const fetchTableMapData = async (showLoading = false) => {
    try {
      // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìŠ¤í”¼ë„ˆ í‘œì‹œ (ë°±ê·¸ë¼ìš´ë“œ ê°±ì‹  ì‹œì—ëŠ” í‘œì‹œí•˜ì§€ ì•ŠìŒ)
      if (showLoading) {
        setLoading(true);
      }
      
      // Floor ì´ë¦„ì„ ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©
      const apiFloor = selectedFloor;
      
      // í…Œì´ë¸” ìš”ì†Œë“¤ ê°€ì ¸ì˜¤ê¸°
      const elementsResponse = await fetch(`${API_URL}/table-map/elements?floor=${apiFloor}`);
      if (elementsResponse.ok) {
        const elements = await elementsResponse.json();
        // ì €ìž¥ëœ textë¥¼ ê·¸ëŒ€ë¡œ ìœ ì§€ (í‘œì‹œëª…ì€ ë Œë” ì‹œ ê³„ì‚°)
        const transformedElements = elements.map((element: any) => ({
          ...element
        }));
        // Normalize: Occupied/Payment Pending without a linked order must NOT happen.
        const normalizedElements = transformedElements.map((el: any) => {
          const st = String(el?.status || 'Available');
          const isOccupiedLike = st === 'Occupied' || st === 'Payment Pending';
          const hasOrderId = el?.current_order_id != null && String(el.current_order_id) !== '';
          if (isOccupiedLike && !hasOrderId) return { ...el, status: 'Available' };
          return el;
        });
        // Optimistically apply last occupied table state (for up to 60s)
        let patchedElements = normalizedElements;
        try {
          const raw = localStorage.getItem('lastOccupiedTable');
          if (raw) {
            const hint = JSON.parse(raw);
            if (hint && hint.floor === apiFloor && Date.now() - (hint.ts || 0) < 60000) {
              patchedElements = normalizedElements.map((el: any) => {
                if (String(el.id) !== String(hint.tableId)) return el;
                const hintedStatus = String(hint.status || '');
                const isOccupiedLike = hintedStatus === 'Occupied' || hintedStatus === 'Payment Pending';
                const hasOrderId = el?.current_order_id != null && String(el.current_order_id) !== '';
                if (isOccupiedLike && !hasOrderId) return el;
                return { ...el, status: hintedStatus || el.status };
              });
            }
          }
        } catch {}
        setTableElements(patchedElements);
        setTableHoldInfo(prev => {
          const ids = Object.keys(prev);
          if (ids.length === 0) return prev;
          const next = { ...prev };
          let changed = false;
          for (const tId of ids) {
            const el = patchedElements.find((e: any) => String(e.id) === tId);
            if (el && el.status === 'Occupied' && el.current_order_id) {
              delete next[tId];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        try {
          patchedElements.forEach((element: any) => {
            const key = `lastOrderIdByTable_${element.id}`;
            if (
              element &&
              (element.status === 'Occupied' || element.status === 'Payment Pending') &&
              element.current_order_id != null
            ) {
              localStorage.setItem(key, String(element.current_order_id));
            } else {
              localStorage.removeItem(key);
            }
          });
        } catch {}

        // 1) localStorage 복원 + Available/주문 변경 시 예약자명 캐시 정리 (결제 후 다음 손님에게 과거 예약자가 보이지 않도록)
        try {
          const tRaw = localStorage.getItem(`occupiedTimes_${selectedFloor}`);
          if (tRaw) setTableOccupiedTimes(JSON.parse(tRaw));
        } catch {}
        try {
          let namesParsed: Record<string, string> = {};
          let detailsParsed: Record<string, TableReservationDetailRow> = {};
          try {
            const nRaw = localStorage.getItem(`reservedNames_${selectedFloor}`);
            if (nRaw) namesParsed = JSON.parse(nRaw);
          } catch {}
          try {
            const dRaw = localStorage.getItem(`reservationDetails_${selectedFloor}`);
            if (dRaw) detailsParsed = JSON.parse(dRaw);
          } catch {}
          const cleaned = purgeStaleTableReservationMaps(
            patchedElements,
            namesParsed,
            detailsParsed,
            tableMapOrderIdByTableRef.current
          );
          tableMapOrderIdByTableRef.current = cleaned.nextOrderIdByTable;
          try {
            localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(cleaned.names));
            localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(cleaned.details));
          } catch {}
          setTableReservationNames(cleaned.names);
          setTableReservationDetails(cleaned.details);
        } catch {}

        // 비어 있는 테이블의 테이블별 서버 캐시 제거 (다음 손님에게 이전 Jay/Bill 라벨이 남지 않도록)
        // 점유 테이블: DB 연결 주문의 server_*가 로컬과 다르면 갱신 (시프트 클로징 넘겨받기 등)
        try {
          let clearedSrv = false;
          for (const element of patchedElements) {
            const st = String(element?.status || '');
            if (st === 'Available' || st === 'Cleaning') {
              if (loadServerAssignment('table', element.id)) {
                clearServerAssignment('table', element.id);
                clearedSrv = true;
              }
            } else if (st === 'Occupied' || st === 'Payment Pending') {
              const on = (element as any).order_server_name;
              const oid = (element as any).order_server_id;
              const nameTrim = on != null ? String(on).trim() : '';
              if (!nameTrim || oid == null || oid === '') continue;
              try {
                const cur = loadServerAssignment('table', element.id);
                const sidStr = String(oid);
                if (!cur || cur.serverName !== nameTrim || String(cur.serverId) !== sidStr) {
                  saveServerAssignment('table', element.id, { serverId: sidStr, serverName: nameTrim });
                  clearedSrv = true;
                }
              } catch {}
            }
          }
          if (clearedSrv) setServerTableAssignmentTick((x) => x + 1);
        } catch {}

        // 2) ì €ìž¥ê°’ì´ ì—†ì„ ë•Œë§Œ ì´ˆê¸° ë¶€íŒ… ë³´ì • (í˜„ìž¬ ì‹œê°„ì„ ì‹œë“œ)
        if (Object.keys(tableOccupiedTimes).length === 0) {
          const occupiedTimesSeed: Record<string, number> = {};
          patchedElements.forEach((element: any) => {
            if ((element.status === 'Occupied' || element.status === 'Payment Pending') && element.current_order_id != null) {
              // ì‹œë“œê°€ ì—†ìœ¼ë©´ í˜„ìž¬ì‹œê°„ìœ¼ë¡œ, ìžˆìœ¼ë©´ ìœ ì§€
              const key = String(element.id);
              const existing = (() => { try { return JSON.parse(localStorage.getItem(`occupiedTimes_${selectedFloor}`) || '{}')[key]; } catch { return undefined; } })();
              occupiedTimesSeed[key] = existing || Date.now();
            }
          });
          if (Object.keys(occupiedTimesSeed).length > 0) {
            setTableOccupiedTimes(prev => ({ ...occupiedTimesSeed, ...prev }));
            try { localStorage.setItem(`occupiedTimes_${selectedFloor}`, JSON.stringify({ ...occupiedTimesSeed, ...tableOccupiedTimes })); } catch {}
          }
        }
      } else {
        console.warn('í…Œì´ë¸” ìš”ì†Œë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ê¸°ë³¸ê°’ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
        setTableElements([]);
      }

      // í™”ë©´ í¬ê¸° ì„¤ì • ê°€ì ¸ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©)
      const screenResponse = await fetch(`${API_URL}/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
      if (screenResponse.ok) {
        const screen = await screenResponse.json();
        // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í™”ë©´ë¹„/í”½ì…€ì„ ê·¸ëŒ€ë¡œ ì ìš©
        setScreenSize({ 
          width: String(screen.width), 
          height: String(screen.height), 
          scale: screen.scale || 1 
        });
      } else {
        console.warn('í™”ë©´ í¬ê¸°ë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•œ ê¸°ë³¸ê°’(1024x768)ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
        // Auto-detect screen size
        const detectedWidth = window.innerWidth;
        const detectedHeight = window.innerHeight;
        console.log(`🖥️ [Auto-detect] No saved screen size, using current: ${detectedWidth}x${detectedHeight}`);
        setScreenSize({ width: String(detectedWidth), height: String(detectedHeight), scale: 1 });
        
        // Save detected size to DB
        try {
          await fetch(`${API_URL}/table-map/screen-size`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floor: apiFloor, width: detectedWidth, height: detectedHeight, scale: 1 })
          });
          console.log('✅ [Auto-detect] Screen size saved to database');
        } catch (saveErr) {
          console.warn('⚠️ [Auto-detect] Failed to save screen size:', saveErr);
        }
      }
      checkHoldRef.current?.();
    } catch (err) {
      console.error('ë°ì´í„° ê°€ì ¸ì˜¤ê¸° ì˜¤ë¥˜:', err);
      setError('ë°ì´í„°ë¥¼ ë¶ˆëŸ¬ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.');
    } finally {
      // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìƒíƒœ í•´ì œ
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    tableMapOrderIdByTableRef.current = {};
  }, [selectedFloor]);

  useEffect(() => {
    fetchTableMapData(true);  // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìŠ¤í”¼ë„ˆ í‘œì‹œ
    
    // í…Œì´ë¸” ìƒíƒœ ì‹¤ì‹œê°„ ì—…ë°ì´íŠ¸ë¥¼ ìœ„í•œ íƒ€ì´ë¨¸ (15ì´ˆë§ˆë‹¤)
    const tableRefreshInterval = setInterval(() => {
      fetchTableMapData();  // ë°±ê·¸ë¼ìš´ë“œ ê°±ì‹  - ë¡œë”© ìŠ¤í”¼ë„ˆ ì—†ìŒ
    }, 15000);
    
    return () => clearInterval(tableRefreshInterval);
  }, [selectedFloor]);

  useEffect(() => {
    if (!isBistroSalesRoute || !tableElements.length) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = tableElements.map((e: any) => ({
          id: String(e.id),
          status: String(e.status || 'Available'),
          current_order_id:
            e.current_order_id != null &&
            String(e.current_order_id) !== '' &&
            Number.isFinite(Number(e.current_order_id))
              ? Number(e.current_order_id)
              : null,
        }));
        const changed = await syncBistroTableMapFromOrders(payload, bistroSessionOrders);
        if (!cancelled && changed) {
          await fetchTableMapData(false);
        }
      } catch (e) {
        console.warn('[SalesPage/Bistro] table map sync', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBistroSalesRoute, tableElements, bistroSessionOrders, selectedFloor]);

  const checkHoldRef = useRef<() => Promise<void>>(undefined);
  checkHoldRef.current = async () => {
    try {
      const [availRes, upcomingRes] = await Promise.all([
        fetch(`${API_URL}/table-map/elements/available-count`),
        fetch(`${API_URL}/reservations/reservations/upcoming-hold?minutes_before=45`)
      ]);
      if (!availRes.ok || !upcomingRes.ok) return;
      const { count: availCount } = await availRes.json();
      const upcomingList: any[] = await upcomingRes.json();
      if (!upcomingList || upcomingList.length === 0) { setTableHoldInfo({}); return; }
      const reservationsNeedingTables = upcomingList.filter((r: any) => r.status !== 'completed');
      const totalTablesNeeded = reservationsNeedingTables.reduce((sum: number, r: any) => sum + (r.tables_needed || 1), 0);

      if (availCount > 0 && reservationsNeedingTables.length > 0) {
        const availableTables = tableElements.filter(
          (el: any) => el.status === 'Available' &&
            (el.type === 'rounded-rectangle' || el.type === 'circle' || el.type === 'bar' || el.type === 'room')
        );
        const prevHold = tableHoldInfo;
        const holdTableIds = Object.keys(prevHold);
        if (holdTableIds.length > 0 && availableTables.length > 0) {
          let rsvI = 0;
          for (const avTable of availableTables) {
            if (rsvI >= reservationsNeedingTables.length) break;
            const rsv = reservationsNeedingTables[rsvI];
            const tId = String(avTable.id);
            try {
              await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tId)}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Reserved' })
              });
            } catch {}
            setTableElements(prev => prev.map(el =>
              String(el.id) === tId ? { ...el, status: 'Reserved', current_order_id: null as any } : el
            ));
            const cName = rsv.customer_name || 'Guest';
            const rTime = rsv.reservation_time || '';
            setTableReservationDetails(prev => {
              const next = { ...prev, [tId]: { name: cName, time: rTime, partySize: rsv.party_size || 0 } };
              try { localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
            setTableReservationNames(prev => {
              const next = { ...prev, [tId]: cName };
              try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
            const oldHoldId = holdTableIds.find(hId => prevHold[hId]?.reservationId === String(rsv.id || ''));
            if (oldHoldId && oldHoldId !== tId) {
              setTableHoldInfo(prev => {
                const copy = { ...prev };
                delete copy[oldHoldId];
                copy[tId] = { customerName: cName, reservationTime: rTime, reservationId: String(rsv.id || '') };
                return copy;
              });
            }
            rsvI++;
          }
          return;
        }
      }

      if (availCount >= totalTablesNeeded) { setTableHoldInfo({}); return; }
      const deficit = totalTablesNeeded - availCount;
      const candidatesRes = await fetch(`${API_URL}/table-map/elements/hold-candidates`);
      if (!candidatesRes.ok) return;
      const candidates: any[] = await candidatesRes.json();
      const newHoldInfo: Record<string, { customerName: string; reservationTime: string; reservationId: string }> = {};
      let assigned = 0;
      let rsvIdx = 0;
      for (const candidate of candidates) {
        if (assigned >= deficit) break;
        if (rsvIdx < reservationsNeedingTables.length) {
          const rsv = reservationsNeedingTables[rsvIdx];
          newHoldInfo[String(candidate.id)] = {
            customerName: rsv.customer_name || 'Guest',
            reservationTime: rsv.reservation_time || '',
            reservationId: String(rsv.id || '')
          };
          assigned++;
          const tablesForThisRsv = rsv.tables_needed || 1;
          if (assigned % tablesForThisRsv === 0) rsvIdx++;
        }
      }
      setTableHoldInfo(newHoldInfo);
    } catch {}
  };

  useEffect(() => {
    checkHoldRef.current?.();
    const onPaymentCompleted = () => { checkHoldRef.current?.(); };
    window.addEventListener('paymentCompleted', onPaymentCompleted);
    return () => { window.removeEventListener('paymentCompleted', onPaymentCompleted); };
  }, []); // paymentCompletedê°€ ë³€ê²½ë  ë•Œë§ˆë‹¤ ë°ì´í„° ë‹¤ì‹œ ê°€ì ¸ì˜¤ê¸°

  // Back Office ì €ìž¥ ì‹ í˜¸(localStorage) ìˆ˜ì‹  ì‹œ ìž¬ë¡œë“œ
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tableMapUpdated' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (!payload || typeof payload !== 'object') return;
          if (!payload.floor || payload.floor === selectedFloor) {
            fetchTableMapData();
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [selectedFloor]);

  useEffect(() => {
    const onChannelVisChange = (e: StorageEvent) => {
      if (e.key === 'tableMapChannelVisibility' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setChannelVis({
            togo: parsed?.togo !== false,
            delivery: parsed?.delivery !== false,
          });
        } catch {}
      }
      if (e.key === 'fsrTogoButtonVisible') {
        setFsrTogoButtonVisible(e.newValue !== 'false');
      }
      if (e.key === TABLE_MAP_TOGO_PANEL_SPLIT_KEY) {
        setTogoPanelSplitPreset(readTableMapTogoPanelSplitFromStorage());
      }
      if (e.key === TABLE_MAP_BISTRO_PANEL_SPLIT_KEY) {
        setBistroTableMapLeftPct(readBistroTableMapLeftPercentFromStorage());
      }
    };
    window.addEventListener('storage', onChannelVisChange);
    return () => window.removeEventListener('storage', onChannelVisChange);
  }, []);

  useEffect(() => {
    const onSplit = () => {
      setTogoPanelSplitPreset(readTableMapTogoPanelSplitFromStorage());
      setBistroTableMapLeftPct(readBistroTableMapLeftPercentFromStorage());
    };
    window.addEventListener(TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT, onSplit);
    return () => window.removeEventListener(TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT, onSplit);
  }, []);

  // ë¼ìš°íŒ… ë³µê·€/íƒ­ ê°€ì‹œì„± ë³€ê²½ ì‹œ í•­ìƒ í™”ë©´ í¬ê¸° ìž¬ì ìš©
  useEffect(() => {
    const onPageShow = () => fetchTableMapData();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchTableMapData();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [selectedFloor]);

  // ì°½ í¬ì»¤ìŠ¤ ì‹œ ìž¬ë¡œë“œ(ë™ì¼ íƒ­ì—ì„œë„ ë°˜ì˜)
  useEffect(() => {
    const onFocus = () => {
      try {
        const raw = localStorage.getItem('tableMapUpdated');
        if (raw) {
          const payload = JSON.parse(raw);
          if (!payload || typeof payload !== 'object') return;
          if (!payload.floor || payload.floor === selectedFloor) {
            fetchTableMapData();
          }
        }
      } catch {}
      try {
        const chRaw = localStorage.getItem('tableMapChannelVisibility');
        if (chRaw) {
          const parsed = JSON.parse(chRaw);
          setChannelVis({
            togo: parsed?.togo !== false,
            delivery: parsed?.delivery !== false,
          });
        }
      } catch {}
      try {
        setTogoPanelSplitPreset(readTableMapTogoPanelSplitFromStorage());
      } catch {}
      try {
        setFsrTogoButtonVisible(localStorage.getItem('fsrTogoButtonVisible') !== 'false');
      } catch {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedFloor]);

  // Occupied í…Œì´ë¸”ì˜ ì‹œê°„ ì—…ë°ì´íŠ¸
  useEffect(() => {
    const interval = setInterval(() => {
      setTableOccupiedTimes(prev => {
        const now = Date.now();
        const updated = { ...prev };
        
        // Occupied ìƒíƒœì¸ í…Œì´ë¸”ë“¤ì˜ ì‹œê°„ ì—…ë°ì´íŠ¸
        tableElements.forEach(table => {
          if (table.status === 'Occupied' && updated[String(table.id)]) {
            const elapsed = Math.floor((now - updated[String(table.id)]) / 1000 / 60); // ë¶„ ë‹¨ìœ„
            // ì‹œê°„ì€ ê·¸ëŒ€ë¡œ ìœ ì§€ (ì—…ë°ì´íŠ¸í•˜ì§€ ì•ŠìŒ)
          }
        });
        
        return updated;
      });
    }, 1000); // 1ì´ˆë§ˆë‹¤ ì—…ë°ì´íŠ¸

    return () => clearInterval(interval);
  }, [tableElements]);

  /**
   * Neumorphic table surface — matching DLV/Online/Togo buttons in the right panel.
   * Light neumorphic: bg #e0e5ec, dual shadow, status-specific background tint.
   */
  const NEUMORPHIC_SHADOW_RAISED = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff';
  const NEUMORPHIC_SHADOW_HOVER  = '8px 8px 16px #b8bec7, -8px -8px 16px #ffffff';
  const NEUMORPHIC_SHADOW_PRESSED = 'inset 4px 4px 8px #b8bec7, inset -4px -4px 8px #ffffff';

  const getGlassTableSurfaceStyle = (rawStatus: string, _tableText?: string): React.CSSProperties => {
    const status = rawStatus || 'Available';

    const STATUS_BG: Record<string, string> = {
      Available:        '#1abc9c',
      Occupied:         '#ffa726',
      'Payment Pending':'#78909c',
      Cleaning:         '#90a4ae',
      Hold:             '#ef5350',
      Reserved:         '#b258c4',
    };
    const STATUS_TEXT: Record<string, string> = {
      Available:        '#003d2e',
      Occupied:         '#bf360c',
      'Payment Pending':'#ffffff',
      Cleaning:         '#263238',
      Hold:             '#ffffff',
      Reserved:         '#4a148c',
    };

    const bg = STATUS_BG[status] || '#e0e5ec';
    const textColor = STATUS_TEXT[status] || '#4B5563';

    const STATUS_NEON: Record<string, string> = {
      Available:        '#0fa882',
      Occupied:         '#ff9100',
      'Payment Pending':'#546e7a',
      Cleaning:         '#607d8b',
      Hold:             '#d50000',
      Reserved:         '#9c27b0',
    };
    const neon = STATUS_NEON[status] || '#00e676';

    return {
      background: `linear-gradient(160deg, ${bg}ee 0%, ${bg} 50%, ${bg}dd 100%)`,
      border: '1px solid rgba(255,255,255,0.3)',
      boxShadow: [
        NEUMORPHIC_SHADOW_RAISED,
        `inset 0 3px 6px rgba(255,255,255,0.45)`,
        `inset 0 -2px 5px rgba(0,0,0,0.15)`,
        `0 0 12px ${neon}55`,
      ].join(', '),
      color: textColor,
      textShadow: 'none',
      overflow: 'hidden',
    };
  };

  // ìš”ì†Œ ìŠ¤íƒ€ì¼ ìƒì„±
  const getElementStyle = (element: TableElement) => {
    const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
    const isSourceTable = isMoveMergeMode && sourceTableId === element.id;
    const status = element.status || 'Available';
    const isOccupied = status === 'Occupied';
    
    // 주문 가능한 요소(Table/Bar/Room)만 pointer ì»¤ì„œ ì ìš©
    const isClickable =
      element.type === 'rounded-rectangle' ||
      element.type === 'circle' ||
      element.type === 'bar' ||
      element.type === 'room';
    const rotationTransform = `rotate(${element.rotation}deg)`;
    
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${element.position.x * elementScale}px`,
      top: `${element.position.y * elementScale}px`,
      width: `${element.size.width * elementScale}px`,
      height: `${element.size.height * elementScale}px`,
      transform: rotationTransform,
      fontSize: `${Math.max(8, element.fontSize * elementScale)}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: isClickable ? 'pointer' : 'default',
      userSelect: 'none',
      border: '2px solid transparent',
      transition: 'all 0.2s ease',
    };

    // Move/Merge ëª¨ë“œì—ì„œ ì¶œë°œ í…Œì´ë¸” í•˜ì´ë¼ì´íŠ¸
    if (isSourceTable) {
      return {
        ...baseStyle,
        border: '5px solid #8B5CF6',
        boxShadow: '0 0 20px rgba(139, 92, 246, 0.8)',
        borderRadius: element.type === 'circle' ? '50%' : '8px',
        background: '#A78BFA',
        color: '#FFFFFF',
        fontWeight: 'bold',
      };
    }

    // Print Bill ëª¨ë“œì—ì„œ Occupied í…Œì´ë¸” í•˜ì´ë¼ì´íŠ¸
    if (isBillPrintMode && isOccupied && isClickable) {
      return {
        ...baseStyle,
        border: '5px solid #10B981',
        boxShadow: '0 0 20px rgba(16, 185, 129, 0.8)',
        borderRadius: element.type === 'circle' ? '50%' : '8px',
        background: '#34D399',
        color: '#FFFFFF',
        fontWeight: 'bold',
      };
    }

    const applyPressedHighlight = (style: React.CSSProperties): React.CSSProperties => {
      if (!(isClickable && isPressed)) return style;
      return {
        ...style,
        boxShadow: NEUMORPHIC_SHADOW_PRESSED,
      };
    };

    // ìš”ì†Œ íƒ€ìž…ë³„ ìŠ¤íƒ€ì¼ ì ìš©
    switch (element.type) {
      case 'rounded-rectangle':
      case 'bar':
      case 'room': {
        const status = element.status || 'Available';
        const glass = getGlassTableSurfaceStyle(status, element.text);
        const holdBorder = status === 'Hold';
        return applyPressedHighlight({
          ...baseStyle,
          ...glass,
          borderRadius: '26px',
          ...(holdBorder
            ? { border: '6px solid rgba(185, 28, 28, 0.55)' }
            : {}),
          fontWeight: 'bold',
        });
      }
      case 'circle': {
        const status = element.status || 'Available';
        const glass = getGlassTableSurfaceStyle(status, element.text);
        const holdBorder = status === 'Hold';
        return applyPressedHighlight({
          ...baseStyle,
          ...glass,
          borderRadius: '50%',
          ...(holdBorder
            ? { border: '6px solid rgba(185, 28, 28, 0.55)' }
            : {}),
          fontWeight: 'bold',
        });
      }
      case 'entrance':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: 'white',
          fontWeight: 'bold',
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'counter':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
          borderRadius: '4px',
          color: 'inherit',
        };
      case 'restroom':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
          color: 'inherit',
        };
      case 'divider':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'wall':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'cook-area':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          fontWeight: 'bold',
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
    }
  };

  // BOì™€ ë™ì¼í•œ ìž…ì²´íš¨ê³¼ ë° ëª¨ì–‘ í´ëž˜ìŠ¤ ì ìš©
  const getElementClass = (element: TableElement) => {
    const glassTableTypes: TableElement['type'][] = ['rounded-rectangle', 'bar', 'room', 'circle'];
    const baseStyle = ['restroom', 'counter'].includes(element.type)
      ? ''
      : glassTableTypes.includes(element.type)
        ? 'hover:-translate-y-px transition-all duration-[250ms]'
        : 'shadow-[inset_3px_3px_8px_rgba(255,255,255,0.3),inset_-3px_-3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[inset_-3px_-3px_8px_rgba(255,255,255,0.3),inset_3px_3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:scale-105 active:scale-95 active:shadow-[inset_4px_4px_10px_rgba(255,255,255,0.2),inset_-4px_-4px_10px_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-300';

    let shapeClass = '';
    switch (element.type) {
      case 'rounded-rectangle':
      case 'bar':
      case 'room':
        shapeClass = 'rounded-[26px]';
        break;
      case 'circle':
        shapeClass = 'rounded-full';
        break;
      case 'entrance':
      case 'wall':
      case 'cook-area':
      case 'other':
        shapeClass = 'rounded-xl';
        break;
      case 'divider':
        shapeClass = 'rounded-full';
        break;
      case 'floor-label':
        shapeClass = 'rounded-lg';
        break;
      default:
        shapeClass = 'rounded-xl';
    }
    const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
    const pressedClass = isPressed ? 'bg-red-500 text-white transition-colors duration-200' : '';
    return `${shapeClass} ${baseStyle} ${pressedClass}`.trim();
  };

  // í…ìŠ¤íŠ¸ ìƒ‰ìƒ ëŒ€ë¹„ ê³„ì‚°
  const getContrastColor = (hexColor: string) => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#FFFFFF';
  };

  // ê°„ë‹¨í•œ ìƒ‰ìƒ ì–´ë‘¡ê²Œ ì²˜ë¦¬
  const darkenColor = (hexColor: string, amount: number) => {
    const hex = hexColor.replace('#', '');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(0, 2), 16) * (1 - amount))));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(2, 2), 16) * (1 - amount))));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(4, 2), 16) * (1 - amount))));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  /** 예약 모달·웨이팅 배정 시 테이블맵/예약 표시 동기화 (ReservationCreateModal 콜백 타입과 호환) */
  const handleGuestFlowTableStatusChanged = (
    tableId: number,
    _tableName: string,
    status: string,
    customerName?: string,
    reservationTime?: string,
    partySize?: number
  ) => {
    fetchTableMapData();
    if ((status === 'Hold' || status === 'Reserved') && customerName) {
      setTableReservationNames(prev => {
        const next = { ...prev, [String(tableId)]: customerName };
        try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
        return next;
      });
    }
    if (status === 'Occupied') {
      const existingTime = tableOccupiedTimes[String(tableId)];
      if (!existingTime) {
        setOccupiedTimestamp(tableId, Date.now());
      }
    }
    if (customerName) {
      setTableReservationDetails(prev => {
        const next = {
          ...prev,
          [String(tableId)]: {
            name: customerName,
            time: reservationTime ?? '',
            partySize: partySize !== undefined && partySize !== null ? Number(partySize) || 0 : 0,
          },
        };
        try { localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  };

  // í…Œì´ë¸” ìƒíƒœ ë³€ê²½ (release ì‹œ ë™ìž‘)
  const handleTableClick = async (element: TableElement) => {
    const clickTime = performance.now();
    console.log('ðŸ–±ï¸ í…Œì´ë¸” í´ë¦­!', element.text, clickTime);
    
    if (!(element.type === 'rounded-rectangle' || element.type === 'circle' || element.type === 'bar' || element.type === 'room')) return;

    // Print Bill ëª¨ë“œ ì²˜ë¦¬
    if (isBillPrintMode) {
      const status = element.status || 'Available';
      if (status === 'Occupied') {
        await printBillForTable(element);
      } else {
        setBillPrintStatus('âŒ Only occupied tables can print bills');
        setTimeout(() => setBillPrintStatus(''), 2000);
      }
      return;
    }

    // Move/Merge ëª¨ë“œ ì²˜ë¦¬
    if (isMoveMergeMode) {
      await handleMoveMergeTableClick(element);
      return;
    }

    try {
      // Assign-from-waiting flow: clicking a table reserves it for the selected waiting entry
      if (selectedWaitingEntry) {
        const tableLabel = element.text || `T${element.id}`;
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Reserved' })
        });
        const waitingId = selectedWaitingEntry.id;
        if (waitingId != null && waitingId !== '') {
          const assignRes = await fetch(`${API_URL}/waiting-list/${encodeURIComponent(String(waitingId))}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_number: tableLabel }),
          });
          if (!assignRes.ok) {
            const errBody = await assignRes.text().catch(() => '');
            try {
              alert(`Waiting list could not be saved (seated): ${errBody || assignRes.status}`);
            } catch {}
          }
        }
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Reserved' } : el));
        const customerName = String(selectedWaitingEntry.customer_name || selectedWaitingEntry.name || '').trim();
        const partySize =
          typeof selectedWaitingEntry.party_size === 'number' && Number.isFinite(selectedWaitingEntry.party_size)
            ? selectedWaitingEntry.party_size
            : 0;
        handleGuestFlowTableStatusChanged(
          Number(element.id),
          String(tableLabel),
          'Reserved',
          customerName || undefined,
          undefined,
          partySize
        );
        setSelectedWaitingEntry(null);
        setShowWaitingModal(false);
        return;
      }
      const currentStatus = element.status || 'Available';
      
      if (currentStatus === 'Available') {
        // Available: Do NOT change to Occupied immediately. Only navigate.
        // Status will change to Occupied when order is saved.
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            tableName: element.text,
            floor: selectedFloor,
            loadExisting: false
          }
        });
      } else if (currentStatus === 'Reserved') {
        const holdData = tableHoldInfo[String(element.id)];
        const rsvDetail = tableReservationDetails[String(element.id)];
        setShowReservedActionModal({
          tableId: String(element.id),
          tableName: element.text || `T${element.id}`,
          isHoldOrigin: !!holdData,
          customerName: rsvDetail?.name || holdData?.customerName || '',
          reservationTime: rsvDetail?.time || holdData?.reservationTime || ''
        });
      } else if (currentStatus === 'Preparing') {
        // Legacy: treat Preparing as Available
        const latestElement = tableElements.find(el => String(el.id) === String(element.id));
        const effectiveOrderId = latestElement?.current_order_id || (element as any).current_order_id;
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            tableName: element.text,
            floor: selectedFloor,
            loadExisting: Boolean(effectiveOrderId),
            orderId: effectiveOrderId || null
          }
        });
      } else if (currentStatus === 'Hold') {
        // Hold table can start ordering, but MUST NOT become Occupied without an actual linked order.
        const latestElement = tableElements.find(el => String(el.id) === String(element.id));
        const effectiveOrderId = latestElement?.current_order_id || (element as any).current_order_id;
        console.log('ðŸš€ í…Œì´ë¸” í´ë¦­ → OrderPage ì´ë™ ì‹œìž‘', performance.now());
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            tableName: element.text,
            floor: selectedFloor,
            loadExisting: Boolean(effectiveOrderId),
            orderId: effectiveOrderId || null
          }
        });
      } else {
        // Occupied ìƒíƒœì¼ ë•ŒëŠ” ì£¼ë¬¸ íŽ˜ì´ì§€ë¡œ ì´ë™
        // ìµœì‹  ìƒíƒœì—ì„œ current_order_id ê°€ì ¸ì˜¤ê¸° (React ë¹„ë™ê¸° ìƒíƒœ ì—…ë°ì´íŠ¸ ëŒ€ì‘)
        const latestElement = tableElements.find(el => String(el.id) === String(element.id));
        const currentStatus = latestElement?.status || element.status;
        const effectiveOrderId = latestElement?.current_order_id || (element as any).current_order_id;
        
        // If a table is Occupied-like but has no linked order, normalize it back to Available.
        if ((currentStatus === 'Occupied' || currentStatus === 'Payment Pending') && !effectiveOrderId) {
          try {
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'Available' })
            });
          } catch {}
          const holdForThisTable = tableHoldInfo[String(element.id)];
          if (holdForThisTable) {
            try {
              await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Reserved' })
              });
            } catch {}
            setTableElements(prev => prev.map(el =>
              String(el.id) === String(element.id)
                ? { ...el, status: 'Reserved', current_order_id: null as any }
                : el
            ));
            setTableReservationDetails(prev => {
              const next = { ...prev, [String(element.id)]: { name: holdForThisTable.customerName, time: holdForThisTable.reservationTime, partySize: 0 } };
              try { localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
            setTableReservationNames(prev => {
              const next = { ...prev, [String(element.id)]: holdForThisTable.customerName };
              try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
          } else {
            setTableElements(prev => prev.map(el =>
              String(el.id) === String(element.id)
                ? { ...el, status: 'Available', current_order_id: null as any }
                : el
            ));
          }
          clearOccupiedTimestamp(element.id);
          removeReservationDisplayCacheForTable(element.id);
          try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: holdForThisTable ? 'Reserved' : 'Available', ts: Date.now() })); } catch {}
          try {
            localStorage.removeItem(`splitGuests_${element.id}`);
            localStorage.removeItem(`paidGuests_${element.id}`);
            localStorage.removeItem(`voidDisplay_${element.id}`);
            localStorage.removeItem(`lastOrderIdByTable_${element.id}`);
          } catch {}
          window.dispatchEvent(new Event('paymentCompleted'));
          return;
        }

        const hasOrder = Boolean(effectiveOrderId);
        
        console.log('ðŸš€ í…Œì´ë¸” í´ë¦­ → OrderPage ì´ë™ ì‹œìž‘', performance.now(), { 
          status: currentStatus,
          hasOrder, 
          latestOrderId: effectiveOrderId 
        });
        
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            tableName: element.text,
            floor: selectedFloor,
            loadExisting: hasOrder,
            orderId: effectiveOrderId || null  // ê²ŒìŠ¤íŠ¸ ê²°ì œ ìƒíƒœ ë³µì›ì„ ìœ„í•´ orderId ì „ë‹¬
          }
        });
      }
    } catch (e) {
      console.warn('handleTableClick failed:', e);
    } finally {
      setPressedTableId(prev => (prev === String(element.id) ? null : prev));
    }
  };

  const handleBistroAwareTableClick = async (element: TableElement) => {
    try {
      if (!isBistroSalesRoute) {
        await handleTableClick(element);
        return;
      }
      if (
        !(
          element.type === 'rounded-rectangle' ||
          element.type === 'circle' ||
          element.type === 'bar' ||
          element.type === 'room'
        )
      ) {
        return;
      }
      if (isBillPrintMode || isMoveMergeMode || selectedWaitingEntry) {
        await handleTableClick(element);
        return;
      }
      setBistroPendingTableElement(element);
      setServerModalError('');
      setShowServerSelectionModal(true);
    } catch (e) {
      console.warn('handleBistroAwareTableClick failed:', e);
    } finally {
      setPressedTableId(prev => (prev === String(element.id) ? null : prev));
    }
  };

  /**
   * Print Bill for Table
   * í…Œì´ë¸”ì˜ í˜„ìž¬ ì£¼ë¬¸ì— ëŒ€í•´ Bill(ì˜ìˆ˜ì¦)ì„ ì¶œë ¥í•©ë‹ˆë‹¤.
   */
  const printBillForTable = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    setBillPrintStatus(`🔄 Printing bill for ${tableLabel}...`);

    try {
      // 1. í…Œì´ë¸”ì˜ ì£¼ë¬¸ ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const orderId = (element as any).current_order_id;
      if (!orderId) {
        setBillPrintStatus(`âŒ No order found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 2. ì£¼ë¬¸ ìƒì„¸ ì •ë³´ ë° ì•„ì´í…œ ê°€ì ¸ì˜¤ê¸° (ë‹¨ì¼ API í˜¸ì¶œ)
      const orderResponse = await fetch(`${API_URL}/orders/${orderId}`);
      if (!orderResponse.ok) {
        throw new Error('Failed to fetch order');
      }
      const orderData = await orderResponse.json();
      
      if (!orderData.success) {
        throw new Error(orderData.error || 'Failed to fetch order');
      }

      const items = orderData.items || [];

      if (!items || items.length === 0) {
        setBillPrintStatus(`âŒ No items found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 4. Store ì •ë³´ ê°€ì ¸ì˜¤ê¸° (business profile)
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // 5. Tax ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      // 6. Guestë³„ë¡œ ì•„ì´í…œ ê·¸ë£¹í™”
      const byGuest: { [guestNumber: number]: any[] } = {};
      items.forEach((item: any) => {
        const guestNum = item.guest_number || 1;
        if (!byGuest[guestNum]) byGuest[guestNum] = [];
        const itemPrice = item.price || 0;
        const itemQty = item.quantity || 1;
        byGuest[guestNum].push({
          name: item.name || 'Unknown Item',
          quantity: itemQty,
          unitPrice: itemPrice,
          total: itemQty * itemPrice,
          modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : [],
          togoLabel: !!(item as any).togo_label
        });
      });

      // 7. ê¸ˆì•¡ ê³„ì‚°
      const subtotal = items.reduce((sum: number, item: any) => {
        const price = item.price || 0;
        const qty = item.quantity || 1;
        return sum + (price * qty);
      }, 0);

      const printBillTotals = orderListCalculateTotals();
      const taxesTotal = printBillTotals.tax;
      const total = printBillTotals.total;

      // 8. ì˜ìˆ˜ì¦ ë°ì´í„° êµ¬ì„±
      const now = new Date();
      const order = orderData.order || orderData;
      const fullReceipt = {
        type: 'prebill',
        header: { 
          title: store.name, 
          address: store.address, 
          phone: store.phone, 
          dateTime: getLocalDatetimeString(now), 
          orderNumber: order.order_number ? `#${order.order_number}` : orderId 
        },
        orderInfo: { 
          channel: 'DINE-IN', 
          table: tableLabel,
          tableName: tableLabel
        },
        body: { 
          guestSections: Object.keys(byGuest).sort((a, b) => Number(a) - Number(b)).map(k => ({ 
            guestNumber: Number(k), 
            items: byGuest[Number(k)] 
          })), 
          subtotal, 
          adjustments: [], 
          taxLines: printBillTotals.taxLines || [], 
          taxesTotal, 
          total 
        },
        footer: { message: 'Thank you for dining with us!' }
      };

      // 9. í”„ë¦°í„°ë¡œ ì¶œë ¥ (print-bill API ì‚¬ìš© - billLayout ì ìš©)
      await printBill({
        header: fullReceipt.header,
        orderInfo: fullReceipt.orderInfo,
        guestSections: fullReceipt.body.guestSections,
        subtotal: fullReceipt.body.subtotal,
        adjustments: fullReceipt.body.adjustments,
        taxLines: fullReceipt.body.taxLines,
        taxesTotal: fullReceipt.body.taxesTotal,
        total: fullReceipt.body.total,
        footer: fullReceipt.footer
      }, 1);
      
      setBillPrintStatus(`✅ Bill printed for ${tableLabel}`);
      setTimeout(() => {
        setIsBillPrintMode(false);
        setBillPrintStatus('');
      }, 1500);
    } catch (error: any) {
      console.error('Print bill error:', error);
      setBillPrintStatus(`âŒ Print failed: ${error.message}`);
      setTimeout(() => setBillPrintStatus(''), 3000);
    }
  };

  /**
   * Order List ê´€ë ¨ í•¨ìˆ˜ë“¤
   */
  /** Pickup LIST: 온라인/투고 패널 행 병합 없음 — API 주문만 사용 */
  const mergeOnlineCardsForPickup = useCallback((dbOrders: any[], mode?: 'history' | 'pickup') => {
    const effectiveMode = mode ?? orderListOpenMode;
    if (effectiveMode !== 'pickup') return dbOrders;
    return dbOrders;
  }, [orderListOpenMode]);

  const fetchOrderList = async (date: string, mode?: 'history' | 'pickup') => {
    const effectiveMode = mode ?? orderListOpenMode;
    console.log('[fetchOrderList] Fetching orders for date:', date, 'mode:', effectiveMode);
    console.log(
      '[fetchOrderList] API URL:',
      effectiveMode === 'pickup'
        ? `${API_URL}/orders?pickup_pending=1&session_scope=1`
        : `${API_URL}/orders?date=${date}&session_scope=1`
    );
    setOrderListLoading(true);
    try {
      // Fetch tax rate for order list display
      if (orderListTaxRate === 0 || orderListActiveTaxes.length === 0 || Object.keys(orderListTaxGroupMap).length === 0) {
        try {
          const [taxResponse, taxGroupResponse] = await Promise.all([
            fetch(`${API_URL}/taxes`),
            fetch(`${API_URL}/tax-groups`),
          ]);
          const taxes = await taxResponse.json();
          if (Array.isArray(taxes) && taxes.length > 0) {
            const activeTaxes = taxes.filter((t: any) => !t.is_deleted);
            if (activeTaxes.length > 0) {
              const rate = parseFloat(activeTaxes[0].rate) || 0;
              const finalRate = rate > 1 ? rate / 100 : rate;
              setOrderListTaxRate(finalRate);
              setOrderListActiveTaxes(activeTaxes.map((t: any) => ({
                name: t.name || 'Tax',
                rate: parseFloat(t.rate) > 1 ? parseFloat(t.rate) / 100 : parseFloat(t.rate),
              })));
            }
          }
          const taxGroups = await taxGroupResponse.json();
          if (Array.isArray(taxGroups)) {
            const groupMap: Record<number, Array<{ name: string; rate: number }>> = {};
            taxGroups.forEach((g: any) => {
              if (g.id && Array.isArray(g.taxes)) {
                groupMap[g.id] = g.taxes.map((t: any) => ({ name: t.name || 'Tax', rate: Number(t.rate || 0) }));
              }
            });
            setOrderListTaxGroupMap(groupMap);
          }
        } catch (e) {
          console.error('Failed to fetch tax data for order list:', e);
        }
      }

      const ordersUrl = effectiveMode === 'pickup'
        ? `${API_URL}/orders?pickup_pending=1&session_scope=1`
        : `${API_URL}/orders?date=${date}&session_scope=1`;
      const [ordersRes, deliveryMetaRes] = await Promise.all([
        fetch(ordersUrl),
        fetch(`${API_URL}/orders/delivery-orders`)
      ]);
      const data = await ordersRes.json();
      const deliveryMetaJson = deliveryMetaRes.ok ? await deliveryMetaRes.json() : { orders: [] };
      const deliveryMetaOrders = Array.isArray(deliveryMetaJson?.orders)
        ? deliveryMetaJson.orders
        : (Array.isArray(deliveryMetaJson) ? deliveryMetaJson : []);
      const finalizeOrderListRows = (arr: any[]) => {
        const merged = mergeOnlineCardsForPickup(arr, effectiveMode);
        if (effectiveMode !== 'pickup') return merged;
        return applyPanelSyncToPickupListRows(
          merged,
          togoOrdersPanelSyncRef.current,
          onlineQueueCardsPanelSyncRef.current,
          swipeRemovedPanelIdsRef.current
        );
      };
      console.log('[fetchOrderList] Response:', data);
      console.log('[fetchOrderList] Orders count:', data.orders?.length || 0);
      if (data.success && Array.isArray(data.orders)) {
        // delivery_orders 메타(채널명/외부 주문번호) 병합
        const baseOrders = data.orders;
        if (deliveryMetaOrders.length > 0) {
          const orderMap = new Map<number, any>();
          baseOrders.forEach((o: any) => orderMap.set(Number(o.id), { ...o }));
          const tableIdToOrderId = new Map<string, number>();
          baseOrders.forEach((o: any) => {
            if (o?.table_id && String(o.table_id).startsWith('DL')) {
              tableIdToOrderId.set(String(o.table_id).substring(2), Number(o.id));
            }
          });
          deliveryMetaOrders.forEach((meta: any) => {
            const metaIdStr = String(meta?.id ?? '');
            const mappedOrderId = tableIdToOrderId.get(metaIdStr);
            const matchId = Number(meta?.order_id || mappedOrderId || 0);
            const existing = matchId ? orderMap.get(matchId) : null;
            if (existing) {
              existing.deliveryCompany = meta.delivery_company || meta.deliveryCompany || existing.deliveryCompany;
              existing.deliveryOrderNumber = meta.delivery_order_number || meta.deliveryOrderNumber || existing.deliveryOrderNumber;
              // Delivery로 확실히 판단 가능하도록 fulfillment 보정
              existing.fulfillment_mode = existing.fulfillment_mode || 'delivery';
              const rtl = meta.ready_time_label || meta.readyTimeLabel;
              if (rtl && String(rtl).trim()) {
                existing.readyTimeLabel = existing.readyTimeLabel || rtl;
                if (!existing.ready_time && !existing.readyTime) {
                  existing.ready_time = String(rtl).trim();
                }
              }
              const pt = Number(meta.prep_time ?? meta.prepTime ?? 0);
              if (Number.isFinite(pt) && pt > 0) {
                const cur = Number(existing.pickup_minutes ?? existing.pickupMinutes ?? 0);
                if (!Number.isFinite(cur) || cur <= 0) {
                  existing.pickup_minutes = pt;
                }
              }
            }
          });
          setOrderListOrders(finalizeOrderListRows(Array.from(orderMap.values())));
        } else {
          setOrderListOrders(finalizeOrderListRows(baseOrders));
        }
      } else if (Array.isArray(data)) {
        setOrderListOrders(finalizeOrderListRows(data));
      } else {
        setOrderListOrders(finalizeOrderListRows([]));
      }
    } catch (error) {
      console.error('Failed to fetch order list:', error);
      setOrderListOrders([]);
    } finally {
      setOrderListLoading(false);
    }
  };
  fetchOrderListRef.current = fetchOrderList;

  useEffect(() => {
    const onTakeoutDayClosed = () => {
      setOrderListOrders([]);
      setOrderListSelectedOrder(null);
      setOrderListSelectedItems([]);
      setOrderListVoidLines([]);
      swipeRemovedPanelIdsRef.current = new Set();
      previousDeliveryPanelKeysRef.current = new Set();
      isFirstDeliveryPanelLoadRef.current = true;
      void loadTogoOrders();
      void fetchOrderListRef.current?.(getLocalDateString(), 'pickup');
    };
    const onTakeoutDayOpened = () => {
      void fetchOrderListRef.current?.(getLocalDateString(), 'pickup');
      void fetchOrderListRef.current?.(orderListDate, orderListOpenMode);
    };
    window.addEventListener('posTakeoutDayClosed', onTakeoutDayClosed);
    window.addEventListener('posTakeoutDayOpened', onTakeoutDayOpened);
    return () => {
      window.removeEventListener('posTakeoutDayClosed', onTakeoutDayClosed);
      window.removeEventListener('posTakeoutDayOpened', onTakeoutDayOpened);
    };
  }, [loadTogoOrders, orderListDate, orderListOpenMode]);

  const fetchOrderDetails = async (orderId: number) => {
    try {
      const response = await fetch(`${API_URL}/orders/${orderId}`);
      if (!response.ok) {
        console.error(`Failed to fetch order details: HTTP ${response.status}`);
        // 응답 실패 시에도 기본 주문 정보는 목록에서 가져와 표시
        const listOrder = orderListOrders.find((o: any) => o.id === orderId);
        if (listOrder) {
          setOrderListSelectedOrder({ ...listOrder, adjustments: [] });
          setOrderListSelectedItems([]);
        }
        return;
      }
      const data = await response.json();
      if (data.success) {
        // 목록에서 가져온 table_name을 유지 (상세 API에는 JOIN 없음)
        const listOrder = orderListOrders.find((o: any) => o.id === orderId);
        const tableName = listOrder?.table_name || data.order.table_name || '';
        // ✅ Compute the same numbers the "togo modal" would show ONCE,
        // then reuse those exact numbers everywhere (detail, pay, etc.)
        let items = Array.isArray(data.items) ? data.items : [];
        items = await fetchPickupDetailItemsPreferFirebase(API_URL, data.order, items);
        let computedTotals: null | {
          subtotal: number;
          tax: number;
          taxLines: Array<{ name: string; amount: number }>;
          total: number;
        } = null;
        try {
          const normalizedItems = (items || []).map((it: any) => {
            let discountObj: any = it.discount ?? null;
            if (!discountObj && it.discount_json) {
              try { discountObj = typeof it.discount_json === 'string' ? JSON.parse(it.discount_json) : it.discount_json; } catch { discountObj = null; }
            }
            return {
              id: it.id ?? it.item_id ?? it.itemId ?? it.order_line_id ?? it.orderLineId ?? `${it.name || 'line'}`,
              orderLineId: it.order_line_id ?? it.orderLineId,
              name: it.name,
              type: it.type,
              quantity: it.quantity,
              price: (typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0)),
              totalPrice: (it.total_price ?? it.totalPrice),
              modifiers: it.modifiers ?? it.options ?? [],
              memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
              discount: discountObj,
              guestNumber: it.guestNumber ?? it.guest_number,
              taxGroupId: it.taxGroupId ?? it.tax_group_id,
              void_id: it.void_id,
              voidId: it.voidId,
              is_void: it.is_void,
            };
          });
          const pricing = calculateOrderPricing(normalizedItems as any);
          const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
          const storedTotalRaw = Number((data.order?.total ?? 0) as any);
          const storedTotal = Number.isFinite(storedTotalRaw) ? Number(storedTotalRaw.toFixed(2)) : Number((pricing.totals.total || 0).toFixed(2));
          const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
          const taxLines = derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [];
          computedTotals = { subtotal: netSubtotal, tax: derivedTax, taxLines, total: storedTotal };
        } catch {
          computedTotals = null;
        }

        setOrderListSelectedOrder({
          ...data.order,
          table_name: tableName,
          deliveryCompany: listOrder?.deliveryCompany || data.order.deliveryCompany,
          deliveryOrderNumber: listOrder?.deliveryOrderNumber || data.order.deliveryOrderNumber,
          adjustments: data.adjustments || [],
          __togoTotals: computedTotals,
        } as any);
        setOrderListSelectedItems(items);
        setOrderListVoidLines(data.voidLines || []);
      } else {
        // success가 false인 경우에도 기본 정보 표시
        const listOrder = orderListOrders.find((o: any) => o.id === orderId);
        if (listOrder) {
          setOrderListSelectedOrder({ ...listOrder, adjustments: [] });
          setOrderListSelectedItems([]);
          setOrderListVoidLines([]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch order details:', error);
      // 에러 시에도 기본 주문 정보는 목록에서 가져와 표시
      const listOrder = orderListOrders.find((o: any) => o.id === orderId);
      if (listOrder) {
        setOrderListSelectedOrder({ ...listOrder, adjustments: [] });
        setOrderListSelectedItems([]);
      }
    }
  };

  // Live Order ë¡œë“œ - í…Œì´ë¸”ë³„ ë¯¸ê²°ì œ ì£¼ë¬¸
  const fetchLiveOrders = useCallback(async () => {
    try {
      // ë¨¼ì € í…Œì´ë¸” ë°ì´í„°ë¥¼ ìµœì‹  ìƒíƒœë¡œ ê°€ì ¸ì˜¤ê¸° (ëª¨ë“  ì¸µ)
      let currentTableElements = tableElements;
      try {
        const tableRes = await fetch(`${API_URL}/table-map/elements`);
        if (tableRes.ok) {
          const tableData = await tableRes.json();
          currentTableElements = tableData.elements || tableData || [];
        }
      } catch (e) {
        console.warn('[Live Order] Failed to fetch latest table data:', e);
      }

      // í…Œì´ë¸”ì— ì—°ê²°ëœ ì£¼ë¬¸ ID ê°€ì ¸ì˜¤ê¸°
      const tableOrdersMap: { tableId: string; tableLabel: string; orderId: string }[] = [];
      
      currentTableElements
        .filter((t: any) => t.type === 'rounded-rectangle' || t.type === 'circle')
        .forEach((table: any) => {
          // 1. DBì—ì„œ ê°€ì ¸ì˜¨ current_order_id ìš°ì„  í™•ì¸
          // 2. localStorageì˜ lastOrderIdByTable_ í‚¤ í™•ì¸ (OrderPageì™€ ë™ì¼)
          const dbOrderId = table.current_order_id;
          const localOrderId = localStorage.getItem(`lastOrderIdByTable_${table.id}`);
          const orderId = dbOrderId || localOrderId;
          
          console.log(`[Live Order] Table ${table.id}: DB orderId=${dbOrderId}, Local orderId=${localOrderId}`);
          
          if (orderId && orderId !== 'null' && orderId !== '' && String(orderId) !== '0') {
            tableOrdersMap.push({
              tableId: table.id,
              tableLabel: table.text || `Table ${table.id}`,
              orderId: String(orderId)
            });
          }
        });

      console.log('[Live Order] Tables with orders:', tableOrdersMap);

      // ê° ì£¼ë¬¸ì˜ ìƒì„¸ ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const ordersWithDetails = await Promise.all(
        tableOrdersMap.map(async (tableOrder) => {
          try {
            const response = await fetch(`${API_URL}/orders/${tableOrder.orderId}`);
            const data = await response.json();
            console.log(`[Live Order] Order ${tableOrder.orderId} data:`, data);
            
            if (data.success && data.order) {
              // PENDING, UNPAID, ë˜ëŠ” ë¹ˆ ìƒíƒœë§Œ í¬í•¨ (ê²°ì œ ì™„ë£Œëœ ì£¼ë¬¸ ì œì™¸)
              const status = (data.order.status || '').toUpperCase();
              const isPaid = status === 'PAID' || status === 'CLOSED' || status === 'COMPLETED';
              
              if (!isPaid) {
                return {
                  ...tableOrder,
                  order: data.order,
                  items: (data.items || []).map((item: any) => ({
                    ...item,
                    modifiers: item.modifiers_json ? JSON.parse(item.modifiers_json) : [],
                    memo: item.memo_json ? JSON.parse(item.memo_json) : null
                  }))
                };
              } else {
                console.log(`[Live Order] Order ${tableOrder.orderId} is paid, skipping`);
              }
            }
          } catch (err) {
            console.error(`Failed to fetch order ${tableOrder.orderId}:`, err);
          }
          return null;
        })
      );

      setLiveOrders(ordersWithDetails.filter(Boolean));
    } catch (error) {
      console.error('Failed to fetch live orders:', error);
    }
  }, [tableElements, API_URL]);

  // Live Order íƒ­ ì„ íƒ ì‹œ ì´ˆê¸° ë¡œë“œ
  useEffect(() => {
    if (orderListTab === 'live' && showOrderListModal) {
      fetchLiveOrders();
    }
  }, [orderListTab, showOrderListModal, fetchLiveOrders]);

  // ì£¼ë¬¸ ìƒì„±/ê²°ì œ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ - Live Order ì‹¤ì‹œê°„ ì—…ë°ì´íŠ¸
  useEffect(() => {
    const handleOrderChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('[Live Order] Event received:', e.type, detail);
      
      // Live Order íƒ­ì´ ì—´ë ¤ìžˆìœ¼ë©´ ì¦‰ì‹œ ìƒˆë¡œê³ ì¹¨
      if (orderListTab === 'live' && showOrderListModal) {
        fetchLiveOrders();
      }
      // Pickup List 모달이 열린 상태에서 결제/갱신 시 목록 즉시 동기화(Pay & Pickup 완료 후 제거)
      if (showOrderListModal && orderListOpenMode === 'pickup') {
        void fetchOrderListRef.current?.(orderListDate, 'pickup');
      }
      void loadTogoOrders();
      void loadOnlineOrders();
    };

    // ì»¤ìŠ¤í…€ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ ë“±ë¡
    window.addEventListener('orderCreated', handleOrderChange);
    window.addEventListener('orderPaid', handleOrderChange);
    window.addEventListener('orderUpdated', handleOrderChange);

    return () => {
      window.removeEventListener('orderCreated', handleOrderChange);
      window.removeEventListener('orderPaid', handleOrderChange);
      window.removeEventListener('orderUpdated', handleOrderChange);
    };
  }, [orderListTab, showOrderListModal, orderListOpenMode, orderListDate, fetchLiveOrders, loadTogoOrders, loadOnlineOrders]);

  // 투고패널 카드 → Pay & Pickup 결제 완료 후: 패널에서 해당 투고/온라인 카드 제거
  useEffect(() => {
    const onPanelPickupComplete = (e: Event) => {
      const d = (e as CustomEvent<{
        sqliteOrderId?: number | string;
        firebaseOrderId?: string | null;
        channel?: string;
        deliveryMetaId?: string | number | null;
      }>).detail;
      if (!d) return;
      const sid = d.sqliteOrderId;
      const fid = d.firebaseOrderId;
      const dm = d.deliveryMetaId;
      // load* 직후 서버가 아직 PAID로 남기면 카드가 부활함 — 스와이프와 동일하게 숨김 키 등록
      registerSwipeRemovedPanelIds(sid, fid, dm);
      setTogoOrders((prev) =>
        (prev || []).filter((o: any) => {
          if (sid != null && sid !== '' && String(o?.id) === String(sid)) return false;
          if (fid && String((o as any)?.firebase_order_id || '').trim() === String(fid).trim()) return false;
          if (dm != null && String(dm) !== '' && String((o as any)?.deliveryMetaId || (o as any)?.delivery_meta_id || '') === String(dm))
            return false;
          return true;
        })
      );
      setOnlineQueueCards((prev) =>
        (prev || []).filter((card: any) => {
          if (fid && String(card?.id) === String(fid)) return false;
          if (sid != null && sid !== '' && String(card?.localOrderId) === String(sid)) return false;
          if (sid != null && sid !== '' && String(card?.fullOrder?.localOrderId) === String(sid)) return false;
          if (dm != null && String(dm) !== '' && String((card as any)?.deliveryMetaId || (card as any)?.delivery_meta_id || '') === String(dm))
            return false;
          return true;
        })
      );
      void loadTogoOrders();
      void loadOnlineOrders();
      void fetchOrderListRef.current?.(orderListDate, 'pickup');
    };
    window.addEventListener('panelPickupOrderComplete', onPanelPickupComplete as EventListener);
    return () => window.removeEventListener('panelPickupOrderComplete', onPanelPickupComplete as EventListener);
  }, [loadTogoOrders, loadOnlineOrders, orderListDate]);

  useEffect(() => {
    if (!showOrderListModal || orderListOpenMode !== 'pickup') return;
    setOrderListOrders((prev) => {
      const hasQueue = (prev || []).some((o: any) => o?._fromOnlineQueue || o?._fromTogoPanel);
      if (!hasQueue) return prev;
      return mergeOnlineCardsForPickup(
        (prev || []).filter((o: any) => !o?._fromOnlineQueue && !o?._fromTogoPanel),
        'pickup'
      );
    });
  }, [showOrderListModal, orderListOpenMode, mergeOnlineCardsForPickup]);

  useEffect(() => {
    if (!showOrderListModal || orderListLoading) return;
    if (orderListOrders.length === 0) return;
    const filtered = orderListOrders.filter((order) => {
      if (orderListOpenMode !== 'pickup') return true;
      const _f = String(order.fulfillment_mode || '').toLowerCase();
      const _s = String(order.status || '').toUpperCase();
      const _t = orderListNormalizeChannelToken(order.order_type);
      const isDineIn = _t === 'DINEIN' || _t === 'POS';
      if (isDineIn) return false;
      if (_s === 'PICKED_UP') return false;
      if (_s === 'VOIDED' || _s === 'VOID' || _s === 'REFUNDED') return false;
      const pickupChannel = orderListGetPickupChannel({ ...order, fulfillment: _f });
      const normalizedPickupChannel = pickupChannel === 'other' ? 'togo' : pickupChannel;
      if (orderListChannelFilter === 'delivery') return normalizedPickupChannel === 'delivery';
      return true;
    });
    const now = Date.now();
    const parseRT = (o: any): number | null => {
      if (orderListOpenMode === 'pickup') {
        const createdRaw = o?.created_at || o?.createdAt;
        const pm = Number(o?.pickup_minutes ?? o?.pickupMinutes ?? 0);
        if (createdRaw && Number.isFinite(pm) && pm > 0) {
          const d = new Date(createdRaw);
          if (!Number.isNaN(d.getTime())) return d.getTime() + pm * 60000;
        }
      }
      const rt =
        o.ready_time ||
        o.readyTime ||
        o.readyTimeLabel ||
        o.ready_time_label ||
        '';
      if (!String(rt).trim()) return null;
      const today = new Date();
      const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const p = new Date(`${ds}T${String(rt).trim()}`);
      if (!isNaN(p.getTime())) return p.getTime();
      const m = String(rt).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const isPm = m[3].toUpperCase() === 'PM';
        if (isPm && h < 12) h += 12;
        if (!isPm && h === 12) h = 0;
        const base = new Date(`${ds}T00:00:00`);
        base.setHours(h, min, 0, 0);
        return base.getTime();
      }
      return null;
    };
    filtered.sort((a, b) => {
      const aTime = parseRT(a);
      const bTime = parseRT(b);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return -1;
      if (bTime === null) return 1;
      const aIsPast = aTime <= now;
      const bIsPast = bTime <= now;
      if (aIsPast && !bIsPast) return -1;
      if (!aIsPast && bIsPast) return 1;
      return aTime - bTime;
    });
    if (filtered.length > 0) {
      const selectedId = orderListSelectedOrder?.id;
      const stillInList =
        selectedId != null &&
        filtered.some((o: any) => String(o.id) === String(selectedId));
      const idToFetch = stillInList ? Number(selectedId) : Number(filtered[0].id);
      fetchOrderDetails(idToFetch);
    } else {
      setOrderListSelectedOrder(null);
      setOrderListSelectedItems([]);
    }
    // orderListSelectedOrder는 목록 갱신(polling) 시 선택 유지용으로만 읽음. deps에 id를 넣으면 행 클릭 시 fetchOrderDetails가 이 effect에서 한 번 더 호출됨.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrderListModal, orderListOrders, orderListChannelFilter, orderListLoading, orderListOpenMode]);

  const handleOrderListDateChange = (days: number) => {
    const current = new Date(orderListDate + 'T00:00:00');
    current.setDate(current.getDate() + days);
    const newDate = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
    setOrderListDate(newDate);
    setOrderListSelectedOrder(null);
    setOrderListSelectedItems([]);
    fetchOrderList(newDate);
  };

  /** Pickup List — Pay&Pick 줄일 때 Print/Reprint/Void 10% 축소, Pay&Pick(또는 단일 Pay/Pickup)에 폭 이전 */
  const getOrderListPickupActionFlex = (order: any) => {
    const def = { bar: 1, payPair: 2, pay: 1, payPickup: 1, single: 1 };
    if (!order) return def;
    const _pkType = (order.order_type || '').toUpperCase();
    const _pkTableId = (order.table_id || '').toString().toUpperCase();
    const _pkFulfillment = String(order.fulfillment_mode || '').toLowerCase();
    const _pkIsDelivery =
      _pkType === 'DELIVERY' ||
      _pkFulfillment === 'delivery' ||
      _pkType === 'UBEREATS' ||
      _pkType === 'UBER' ||
      _pkType === 'DOORDASH' ||
      _pkType === 'SKIP' ||
      _pkType === 'SKIPTHEDISHES' ||
      _pkType === 'FANTUAN' ||
      _pkTableId.startsWith('DL');
    const _pkStatus = String(order.status || '').toUpperCase();
    const _pkIsPaid =
      _pkStatus === 'PAID' || _pkStatus === 'COMPLETED' || _pkStatus === 'CLOSED' || _pkIsDelivery;
    const showPayAndPickup = !_pkIsPaid && !_pkIsDelivery;
    if (showPayAndPickup) {
      return { bar: 0.9, payPair: 2.3, pay: 0.9, payPickup: 1.3, single: 1 };
    }
    if (_pkIsPaid || _pkIsDelivery) {
      return { bar: 0.9, payPair: 2, pay: 1, payPickup: 1, single: 1.3 };
    }
    return def;
  };

  const handleOrderListPrintBill = async () => {
    if (!orderListSelectedOrder) return;
    
    try {
      // Store ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // Tax ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      // Guestë³„ë¡œ ì•„ì´í…œ ê·¸ë£¹í™”
      const byGuest: { [guestNumber: number]: any[] } = {};
      orderListSelectedItems.forEach((item: any) => {
        const guestNum = item.guest_number || 1;
        if (!byGuest[guestNum]) byGuest[guestNum] = [];
        const itemPrice = item.price || 0;
        const itemQty = item.quantity || 1;
        byGuest[guestNum].push({
          name: item.name || 'Unknown Item',
          quantity: itemQty,
          unitPrice: itemPrice,
          total: itemQty * itemPrice,
          modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : [],
          togoLabel: !!(item as any).togo_label
        });
      });

      const billTotals = orderListCalculateTotals();
      const subtotal = billTotals.subtotal;
      const billTaxLines = billTotals.taxLines || [];
      const taxesTotal = billTotals.tax;
      const total = billTotals.total;

      const now = new Date();
      const billChannelRaw = String(orderListSelectedOrder.order_type || 'DINE-IN').toUpperCase();
      const billChannel = billChannelRaw === 'POS' ? 'DINE-IN' : billChannelRaw;
      const billTableName =
        (orderListSelectedOrder as any)?.table_name ||
        (orderListSelectedOrder as any)?.tableName ||
        '';
      const fullReceipt = {
        type: 'prebill',
        header: { 
          title: store.name, 
          address: store.address, 
          phone: store.phone, 
          dateTime: getLocalDatetimeString(now), 
          orderNumber: orderListSelectedOrder.order_number || String(orderListSelectedOrder.id).padStart(3, '0') 
        },
        orderInfo: { 
          channel: billChannel,
          table: billTableName || undefined,
          tableName: billTableName || undefined,
          tableId: (orderListSelectedOrder as any)?.table_id || undefined
        },
        body: { 
          guestSections: Object.keys(byGuest).sort((a, b) => Number(a) - Number(b)).map(k => ({ 
            guestNumber: Number(k), 
            items: byGuest[Number(k)] 
          })), 
          subtotal, 
          adjustments: [], 
          taxLines: billTaxLines, 
          taxesTotal, 
          total 
        },
        footer: { message: 'Thank you for dining with us!' }
      };

      // print-bill API ì‚¬ìš© - billLayout ì ìš© (1ìž¥ë§Œ ì¶œë ¥)
      await printBill({
        header: fullReceipt.header,
        orderInfo: fullReceipt.orderInfo,
        guestSections: fullReceipt.body.guestSections,
        subtotal: fullReceipt.body.subtotal,
        adjustments: fullReceipt.body.adjustments,
        taxLines: fullReceipt.body.taxLines,
        taxesTotal: fullReceipt.body.taxesTotal,
        total: fullReceipt.body.total,
        footer: fullReceipt.footer
      }, 1);
      
      console.log('Bill printed successfully');
    } catch (error: any) {
      console.error('Print bill error:', error);
      try {
        setBillPrintStatus(`❌ Print failed: ${error.message}`);
        setTimeout(() => setBillPrintStatus(''), 3000);
      } catch {}
    }
  };

  const handleOrderListPrintReceipt = async () => {
    if (!orderListSelectedOrder) return;
    try {
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      const orderId = orderListSelectedOrder.id;
      let payments: Array<{ method: string; amount: number; tip?: number; change_amount?: number }> = [];
      try {
        const payRes = await fetch(`${API_URL}/payments/order/${orderId}`);
        const payData = await payRes.json();
        if (payData.success && Array.isArray(payData.payments)) {
          payments = payData.payments
            .filter((p: any) => (p.status || '').toUpperCase() !== 'VOIDED')
            .map((p: any) => ({ method: p.payment_method || p.method || 'Unknown', amount: Number(p.amount || 0), tip: Number(p.tip || 0), change_amount: Number(p.change_amount || 0) }));
        }
      } catch {}

      const byGuest: { [guestNumber: number]: any[] } = {};
      orderListSelectedItems.forEach((item: any) => {
        const guestNum = item.guest_number || 1;
        if (!byGuest[guestNum]) byGuest[guestNum] = [];
        byGuest[guestNum].push({
          name: item.name || 'Unknown Item',
          quantity: item.quantity || 1,
          unitPrice: item.price || 0,
          price: item.price || 0,
          totalPrice: (item.price || 0) * (item.quantity || 1),
          total: (item.price || 0) * (item.quantity || 1),
          modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : [],
        });
      });

      const totals = orderListCalculateTotals();
      const subtotal = totals.subtotal;
      const taxTotal = totals.tax;
      const total = totals.total;
      const adjustments: Array<{ label: string; amount: number }> = [];
      if (totals.discountTotal > 0 && totals.promotionName) {
        adjustments.push({ label: totals.promotionName, amount: -totals.discountTotal });
      }

      const channelRaw = String(orderListSelectedOrder.order_type || 'DINE-IN').toUpperCase();
      const channel = channelRaw === 'POS' ? 'DINE-IN' : channelRaw;
      const tableName =
        (orderListSelectedOrder as any)?.table_name ||
        (orderListSelectedOrder as any)?.tableName || '';

      const change = payments.reduce((s, p) => s + (p.change_amount || 0), 0);

      const tipTotal = payments.reduce((s, p) => s + (p.tip || 0), 0);
      const parseMemo = (item: any) => {
        if (item.memo) return item.memo;
        if (!item.memo_json) return null;
        try { return typeof item.memo_json === 'string' ? JSON.parse(item.memo_json) : item.memo_json; } catch { return null; }
      };
      const parseDiscount = (item: any) => {
        if (item.discount) return item.discount;
        if (!item.discount_json) return null;
        try { return typeof item.discount_json === 'string' ? JSON.parse(item.discount_json) : item.discount_json; } catch { return null; }
      };
      const parseMods = (item: any) => {
        if (item.modifiers && Array.isArray(item.modifiers)) return item.modifiers;
        if (!item.modifiers_json) return [];
        try { return typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json; } catch { return []; }
      };

      const mapItem = (item: any) => {
        const mods = parseMods(item);
        const memo = parseMemo(item);
        const disc = parseDiscount(item);
        const memoPrice = memo && typeof memo.price === 'number' ? Number(memo.price) : 0;
        const basePrice = Number(item.totalPrice ?? item.price ?? 0);
        const perUnit = basePrice + memoPrice;
        const gross = perUnit * (item.quantity || 1);
        const discAmount = disc ? Number(disc.amount || 0) : 0;
        const lineTotal = Math.max(0, gross - discAmount);
        return {
          name: item.name || 'Unknown',
          quantity: item.quantity || 1,
          price: item.price || 0,
          totalPrice: basePrice,
          lineTotal,
          originalTotal: discAmount > 0 ? gross : undefined,
          discount: discAmount > 0 ? { type: disc.type || 'Item Discount', value: disc.value || 0, amount: discAmount } : undefined,
          modifiers: mods,
          memo,
        };
      };

      const receiptItems = orderListSelectedItems.map(mapItem);

      const guestSectionsForReceipt: { [g: number]: any[] } = {};
      orderListSelectedItems.forEach((item: any) => {
        const g = item.guest_number || 1;
        if (!guestSectionsForReceipt[g]) guestSectionsForReceipt[g] = [];
        guestSectionsForReceipt[g].push(mapItem(item));
      });

      const displayOrderNumber = orderListSelectedOrder.order_number || String(orderId).padStart(3, '0');
      const receiptPayload = {
        header: {
          orderNumber: displayOrderNumber,
          channel,
          tableName,
          serverName: (orderListSelectedOrder as any)?.server_name || '',
        },
        orderInfo: {
          orderNumber: displayOrderNumber,
          orderType: channel,
          channel,
          tableName,
          customerName: (orderListSelectedOrder as any)?.customer_name || '',
          customerPhone: (orderListSelectedOrder as any)?.customer_phone || '',
          serverName: (orderListSelectedOrder as any)?.server_name || '',
        },
        storeName: store.name,
        orderNumber: displayOrderNumber,
        orderType: channel,
        channel,
        tableName,
        customerName: (orderListSelectedOrder as any)?.customer_name || '',
        customerPhone: (orderListSelectedOrder as any)?.customer_phone || '',
        serverName: (orderListSelectedOrder as any)?.server_name || '',
        items: receiptItems,
        guestSections: Object.keys(guestSectionsForReceipt).sort((a, b) => Number(a) - Number(b)).map(k => ({
          guestNumber: Number(k),
          items: guestSectionsForReceipt[Number(k)]
        })),
        subtotal,
        adjustments,
        taxLines: totals.taxLines || [],
        taxesTotal: taxTotal,
        total,
        payments: payments.map(p => ({ method: p.method, amount: p.amount, tip: p.tip || 0 })),
        tip: tipTotal,
        change: Math.max(0, Number(change.toFixed(2))),
        isReprint: true,
        footer: { message: 'Thank you!' }
      };
      console.log('📋 Receipt payload keys:', Object.keys(receiptPayload), 'items:', receiptPayload.items?.length);
      await printReceipt(receiptPayload, 1);

      console.log('Receipt printed successfully (1 copy)');
    } catch (error: any) {
      console.error('Print receipt error:', error);
      alert(`Receipt print failed: ${error.message || 'Unknown error'}`);
    }
  };

  const handleOrderListPrintKitchen = async () => {
    if (!orderListSelectedOrder) return;
    if (isPanelTogoPayKitchenSuppressActive()) {
      console.log('[OrderList] Kitchen print skipped (panel togo/online payment flow)');
      return;
    }

    try {
      // If user clicks Reprint before details load, fetch items on-demand.
      let itemsForPrint: any[] = Array.isArray(orderListSelectedItems) ? orderListSelectedItems : [];
      const hasAnyPrinterRouting = (arr: any[]) => {
        try {
          return (arr || []).some((it: any) => {
            if (Array.isArray(it?.printerGroupIds) && it.printerGroupIds.length > 0) return true;
            if (Array.isArray(it?.printer_groups) && it.printer_groups.length > 0) return true;
            if (it?.printerGroupId != null) return true;
            if (it?.printer_group_id != null) return true;
            return false;
          });
        } catch {
          return false;
        }
      };

      // If we have no items OR items exist but have no routing info, refetch full order details.
      if (itemsForPrint.length === 0 || !hasAnyPrinterRouting(itemsForPrint)) {
        try {
          const response = await fetch(`${API_URL}/orders/${orderListSelectedOrder.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data?.success) {
              itemsForPrint = Array.isArray(data?.items) ? data.items : [];
              if (itemsForPrint.length > 0) {
                setOrderListSelectedItems(itemsForPrint);
                setOrderListVoidLines(data?.voidLines || []);
                // Keep selected order info in sync (preserve table_name from list if missing)
                try {
                  const listOrder = orderListOrders.find((o: any) => o.id === orderListSelectedOrder.id);
                  const tableName = listOrder?.table_name || data?.order?.table_name || (orderListSelectedOrder as any)?.table_name || '';
                  setOrderListSelectedOrder({ ...(data.order || orderListSelectedOrder), table_name: tableName, adjustments: data.adjustments || [] });
                } catch {}
              }
            }
          }
        } catch {}
      }

      if (!itemsForPrint || itemsForPrint.length === 0) {
        console.warn('[Order History Reprint] No items found to reprint.');
        return;
      }

      // OrderPage의 OK(printKitchenOrders)와 동일한 형태로 아이템 구성:
      // - items: [{ id, name, qty, guestNumber, modifiers, memo, printerGroupIds }]
      // - orderInfo: { orderNumber, table, tableName, tableId, server, orderType, channel, pickupTime, pickupMinutes, kitchenNote, deliveryCompany, deliveryOrderNumber, customerName, customerPhone }
      const printableItems = (itemsForPrint || []).filter((it: any) => {
        // 주문내역 아이템은 보통 type==='item' 이지만, 혹시 섞여 들어오는 라인이 있으면 제외
        if (it?.type && it.type !== 'item') return false;
        return true;
      });

      const printItems = printableItems.map((item: any) => {
        // modifiers 파싱 (orderInfo/items가 섞여 들어오는 다양한 포맷 대응)
        let modifiers: any[] = Array.isArray(item.modifiers) ? item.modifiers : [];
        if (modifiers.length === 0 && item.modifiers_json) {
          try {
            const parsed = typeof item.modifiers_json === 'string'
              ? JSON.parse(item.modifiers_json)
              : item.modifiers_json;
            if (Array.isArray(parsed)) modifiers = parsed;
          } catch {}
        }

        // memo 파싱
        let memo: string | null = null;
        if (item.memo_json) {
          try {
            const parsed = typeof item.memo_json === 'string'
              ? JSON.parse(item.memo_json)
              : item.memo_json;
            memo = parsed?.text || (typeof parsed === 'string' ? parsed : null);
          } catch {}
        } else if (item.memo && typeof item.memo === 'object') {
          memo = item.memo?.text || null;
        } else if (typeof item.memo === 'string') {
          memo = item.memo;
        }

        const printerGroupIds = Array.isArray(item.printerGroupIds) ? item.printerGroupIds :
          Array.isArray(item.printer_groups) ? item.printer_groups :
          (item.printerGroupId || item.printer_group_id) ? [item.printerGroupId || item.printer_group_id] : [];

        // menu item id 우선 (order_items row id(dbId)와 혼동 방지)
        const menuItemId = item.item_id || item.itemId || item.menu_item_id || item.menuItemId || item.id || 0;

        return {
          id: menuItemId,
          name: item.short_name || item.name || 'Unknown',
          qty: item.quantity || item.qty || 1,
          guestNumber: item.guestNumber || item.guest_number || 1,
          modifiers,
          memo,
          printerGroupIds,
          togoLabel: !!(item.togoLabel || item.togo_label),
        };
      });

      // 주문 타입 결정 (OrderPage와 동일한 규칙: TOGO/ONLINE/DELIVERY만 별도, 그 외는 DINE-IN)
      const rawOrderType = String(orderListSelectedOrder.order_type || '').toUpperCase();
      const orderSource = String(orderListSelectedOrder.order_source || '').toUpperCase();
      const deliverySources = ['THEZONE', 'UBEREATS', 'DOORDASH', 'SKIPTHEDISHES', 'SKIP', 'FANTUAN', 'GRUBHUB'];

      const isDeliveryLike =
        rawOrderType === 'DELIVERY' ||
        deliverySources.includes(orderSource) ||
        String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase() === 'delivery';

      const orderTypeDisplay =
        isDeliveryLike ? 'DELIVERY' :
        (rawOrderType === 'TOGO' || rawOrderType === 'TAKEOUT' || rawOrderType === 'TO GO' || rawOrderType === 'TO-GO') ? 'TOGO' :
        rawOrderType === 'ONLINE' ? 'ONLINE' :
        rawOrderType === 'PICKUP' ? 'PICKUP' :
        (rawOrderType === 'FORHERE' || rawOrderType === 'EAT IN' || rawOrderType === 'EATIN' || rawOrderType === 'FOR HERE') ? 'EAT IN' :
        'DINE-IN';

      const isOnlineOrDelivery = orderTypeDisplay === 'ONLINE' || orderTypeDisplay === 'TOGO' || orderTypeDisplay === 'DELIVERY' || orderTypeDisplay === 'PICKUP';
      
      // Pickup ì‹œê°„ ê³„ì‚° (ready_time ë˜ëŠ” pickup_minutes ì‚¬ìš©)
      let pickupTimeStr = '';
      let pickupMinutes = orderListSelectedOrder.pickup_minutes || 0;
      
      if (orderListSelectedOrder.ready_time) {
        pickupTimeStr = normalizeReadyTimeForPrint(orderListSelectedOrder.ready_time);
      } else if (pickupMinutes > 0) {
        const createdAt = new Date(orderListSelectedOrder.created_at);
        const pickupDate = new Date(createdAt.getTime() + pickupMinutes * 60000);
        pickupTimeStr = pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else if (isOnlineOrDelivery) {
        // ì˜¨ë¼ì¸/Togo ì£¼ë¬¸ì¸ë° pickup_minutesê°€ ì—†ìœ¼ë©´ created_at + 20ë¶„ ê¸°ë³¸ê°’ ì‚¬ìš©
        pickupMinutes = 20;
        const createdAt = new Date(orderListSelectedOrder.created_at);
        const pickupDate = new Date(createdAt.getTime() + pickupMinutes * 60000);
        pickupTimeStr = pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      
      const tableNameForPrint =
        (orderListSelectedOrder as any)?.table_name ||
        (orderListSelectedOrder as any)?.tableName ||
        '';
      const tableIdForPrint =
        (orderListSelectedOrder as any)?.table_id ||
        (orderListSelectedOrder as any)?.tableId ||
        '';

      // Delivery 메타 (있으면 사용)
      const metaDeliveryCompany =
        (orderListSelectedOrder as any).deliveryCompany ||
        (orderListSelectedOrder as any).delivery_company ||
        (orderListSelectedOrder as any).deliveryChannel ||
        (orderListSelectedOrder as any).delivery_channel ||
        '';
      const metaDeliveryOrderNumber =
        (orderListSelectedOrder as any).deliveryOrderNumber ||
        (orderListSelectedOrder as any).delivery_order_number ||
        '';

      const response = await fetch(`${API_URL}/printers/print-order`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          items: printItems,
          orderInfo: {
            orderNumber: `#${orderListSelectedOrder.order_number || String(orderListSelectedOrder.id).padStart(3, '0')}`,
            table: tableNameForPrint || '',
            tableName: tableNameForPrint || '',
            tableId: tableIdForPrint || '',
            server: orderListSelectedOrder.server_name || '',
            orderType: orderTypeDisplay,
            channel: orderTypeDisplay,
            pickupTime: pickupTimeStr || '',
            pickupMinutes: pickupMinutes,
            kitchenNote: orderListSelectedOrder.kitchen_note || '',
            deliveryCompany: metaDeliveryCompany || '',
            deliveryOrderNumber: metaDeliveryOrderNumber || '',
            customerName: orderListSelectedOrder.customer_name || '',
            customerPhone: orderListSelectedOrder.customer_phone || '',
            onlineOrderNumber:
              orderTypeDisplay === 'ONLINE' ? String(orderListSelectedOrder.customer_name || '').trim() : '',
          },
          printMode: 'graphic',
          isReprint: true, // Reprint í‘œì‹œ (** REPRINT ** ë°°ë„ˆ ì¶œë ¥)
          isAdditionalOrder: false,
          isPaid: orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'PAID' || orderListSelectedOrder.status === 'closed'
        }) 
      });
      
      let result: any = null;
      try { result = await response.json(); } catch {}
      
      if (!response.ok || !result || result.success !== true) {
        const msg = (result && (result.error || result.message)) || `HTTP ${response.status}`;
        console.error('[Order History Reprint] Print failed:', msg);
        return;
      }

      const results = Array.isArray(result.results) ? result.results : [];
      if (results.length === 0) {
        console.warn('[Order History Reprint] No printer was dispatched. Check Printer settings (Kitchen/Groups).');
        return;
      }

      const printerNames = results
        .map((r: any) => r.printerName || r.printer)
        .filter(Boolean)
        .join(', ');
      console.log(`[Order History Reprint] Sent: ${printerNames}`);
    } catch (error: any) {
      console.error('Print kitchen error:', error);
      console.error('[Order History Reprint] Print failed:', error?.message || error);
    }
  };

  // Order List Modal Helper Functions (moved outside to prevent re-creation on every render)
  const orderListFormatTime = (dateStr: string) => {
      if (!dateStr) return '--:--';
      let d: Date;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
        const [datePart, timePart] = dateStr.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        const [h, m, s] = timePart.split(':').map(Number);
        d = new Date(year, month - 1, day, h, m, s);
      } else {
        d = new Date(dateStr);
      }
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

  const orderListFormatDate = (dateStr: string) => {
      // null/undefined/빈문자열 체크
      if (!dateStr) return '--';
      
      let d: Date;
      
      // YYYY-MM-DD 형식인 경우 로컬 시간으로 파싱 (UTC 변환 방지)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        d = new Date(year, month - 1, day);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
        // YYYY-MM-DD HH:mm:ss (로컬 저장 형식) - 로컬 시간으로 파싱
        const [datePart, timePart] = dateStr.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        const [h, m, s] = timePart.split(':').map(Number);
        d = new Date(year, month - 1, day, h, m, s);
      } else {
        // 다른 형식 (ISO 타임스탬프 등)은 그대로 파싱
        d = new Date(dateStr);
      }
      
      // Invalid Date 체크
      if (isNaN(d.getTime())) return '--';
      
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };
    
    // YYYY-MM-DD 문자열을 로컬 Date 객체로 변환하는 헬퍼 함수
    const parseLocalDate = (dateStr: string): Date => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
      return new Date(dateStr);
    };

  const orderListGetChannelDisplay = (order: any) => {
      const type = (order.order_type || '').toUpperCase();
      // Online channels
      if (type === 'UBEREATS' || type === 'UBER') return 'UberEats';
      if (type === 'DOORDASH') return 'DoorDash';
      if (type === 'SKIP' || type === 'SKIPTHEDISHES') return 'SkipTheDishes';
      if (type === 'ONLINE' || type === 'WEB' || type === 'QR') return 'Online';
      // Delivery
      if (type === 'DELIVERY') return 'Delivery';
      // Pickup
      if (type === 'PICKUP') return 'Pickup';
      // Togo
      if (type === 'TOGO' || type === 'TAKEOUT') return 'Togo';
      // FSR → Dine-in / QSR → Eat In
      return serviceMode === 'FSR' ? 'Dine-in' : 'Eat In';
    };

  /** Pickup List — POS 일일 번호만 (001), 없으면 — */
  const orderListPickupListPosDigits = (order: any): string => {
    const raw = order?.order_number ?? order?.pos_order_number ?? order?.posOrderNumber;
    const s = String(raw ?? '').trim().replace(/^#/, '');
    if (isDailyPosDisplayDigits(s)) return String(Number(s)).padStart(3, '0');
    return '—';
  };

  /**
   * Pickup List — Order ID: Online-7117, 외부채번(UKET0575 등), TOGO -뒤4자리
   */
  const orderListPickupListOrderId = (order: any): string => {
    const type = String(order.order_type || '').toUpperCase();
    const fulfillment = String(order.fulfillment_mode || '').toLowerCase();
    const isDelivery =
      type === 'DELIVERY' ||
      fulfillment === 'delivery' ||
      ['UBEREATS', 'UBER', 'DOORDASH', 'SKIP', 'SKIPTHEDISHES', 'FANTUAN'].includes(type);
    const isOnline = type === 'ONLINE' || type === 'WEB' || type === 'QR';
    const isTogo = type === 'TOGO' || type === 'TAKEOUT' || type === 'PICKUP';
    const phoneDigits = String(order.customer_phone || order.customerPhone || '').replace(/\D/g, '');
    const { company: deliveryCompanyRaw, orderNumber: deliveryOrderNumberRaw } = orderListGetDeliveryMeta(order);
    let ext = String(deliveryOrderNumberRaw || '').replace(/^#/, '').trim();
    if (ext && orderListIsInternalDeliveryMetaId(ext)) ext = '';

    if (isDelivery) {
      if (ext) return ext.toUpperCase();
      const abbr = orderListNormalizeDeliveryAbbr(deliveryCompanyRaw);
      return abbr ? `${abbr}` : '—';
    }
    if (isOnline) {
      const onlineNum = String(order.online_order_number || order.onlineOrderNumber || '').trim().replace(/"/g, '');
      let suffix = '';
      if (onlineNum) suffix = onlineNum.toUpperCase();
      else if (phoneDigits.length >= 4) suffix = phoneDigits.slice(-4);
      else if (phoneDigits.length > 0) suffix = phoneDigits;
      else if (isDailyPosDisplayDigits(order.order_number)) suffix = String(order.order_number).trim();
      return suffix ? `Online-${suffix}` : 'Online';
    }
    if (isTogo) {
      let suffix = '';
      if (phoneDigits.length >= 4) suffix = phoneDigits.slice(-4);
      else if (phoneDigits.length > 0) suffix = phoneDigits;
      else {
        const cn = String(order.customer_name || order.customerName || '').trim();
        if (cn) suffix = cn.slice(0, 8).toUpperCase();
        else if (isDailyPosDisplayDigits(order.order_number)) suffix = String(order.order_number).trim();
      }
      return suffix ? `TOGO -${suffix}` : 'TOGO';
    }
    const nm = String(order.customer_name || order.customerName || '').trim();
    return nm || '—';
  };

  /**
   * 주문 목록 Ready Time(픽업 리스트 컬럼명과 동일) — ready_time·라벨·배달 time 등, 없으면 created_at + pickup_minutes(+prep_time)
   */
  const orderListPickupTimeDisplay = (order: any): string => {
    const candidates: unknown[] = [
      order?.ready_time,
      order?.readyTime,
      order?.readyTimeLabel,
      order?.ready_time_label,
      order?.pickup_time,
      order?.pickupTime,
      order?.pickup_time_label,
      order?.pickupTimeLabel,
      order?.time,
      order?.fullOrder?.ready_time,
      order?.fullOrder?.readyTime,
      order?.fullOrder?.readyTimeLabel,
    ];

    for (const c of candidates) {
      if (c == null) continue;
      if (typeof c === 'number' && Number.isFinite(c) && c > 1e12) {
        const d = new Date(c);
        if (!Number.isNaN(d.getTime())) {
          const formatted = formatTimeAmPm(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
          if (formatted) return formatted;
        }
        continue;
      }
      const s = String(c).trim();
      if (!s) continue;
      const formatted = formatTimeAmPm(s);
      if (formatted) return formatted;
    }

    const createdRaw = order?.created_at || order?.createdAt;
    const pm = Number(order?.pickup_minutes ?? order?.pickupMinutes ?? order?.prep_time ?? order?.prepTime ?? 0);
    if (createdRaw && Number.isFinite(pm) && pm > 0) {
      const d = new Date(createdRaw);
      if (!Number.isNaN(d.getTime())) {
        const readyDate = new Date(d.getTime() + pm * 60000);
        const hh = String(readyDate.getHours()).padStart(2, '0');
        const mm = String(readyDate.getMinutes()).padStart(2, '0');
        return formatTimeAmPm(`${hh}:${mm}`);
      }
    }
    return '';
  };

  /** 배달 카드 배지 — SQLite `delivery_company`(UBEREATS 등) 기준 축약 */
  const orderListNormalizeDeliveryAbbr = (raw: any) => {
      const s = String(raw || '').trim();
      if (!s) return '';
      const key = s.toUpperCase().replace(/\s+/g, '');
      if (key === 'UBEREATS' || key === 'UBER') return 'UBER';
      if (key === 'DOORDASH' || key === 'DOORASH' || key === 'DDASH' || key === 'DASH') return 'DDASH';
      if (key === 'SKIPTHEDISHES' || key === 'SKIP') return 'SKIP';
      if (key === 'FANTUAN' || key === 'FTUAN') return 'FTAN';
      return s.toUpperCase();
    };

  /** delivery_orders.name / customer_name 예: "UberEats #A1B2" — 컬럼이 비었을 때 보조 */
  const orderListParseChannelOrderFromLabel = (label?: string | null): string => {
    const m = String(label || '').match(/#\s*([^\s#]+)/);
    return m ? String(m[1]).trim() : '';
  };
  /** DL{id} 접미사가 JS 타임스탬프(내부 메타 id)인 경우 — 채널 주문번호로 쓰지 않음 */
  const orderListIsInternalDeliveryMetaId = (suffix: string): boolean => {
    const s = String(suffix || '').trim();
    if (!/^\d+$/.test(s)) return false;
    const n = Number(s);
    return s.length >= 12 && s.length <= 14 && n >= 1e12 && n < 1e14;
  };

  /** 우측 패널 딜리버리 카드: 온라인 카드와 동일 — 채널 주문번호 → 전화 뒤 4자리 → POS # (내부 DL 메타 id는 제외) */
  const formatDeliveryPanelDisplayId = (order: any): string => {
    let ext = String(order?.deliveryOrderNumber ?? order?.delivery_order_number ?? '').trim();
    if (ext && orderListIsInternalDeliveryMetaId(ext)) ext = '';
    if (!ext) {
      const fromLabel =
        orderListParseChannelOrderFromLabel(order?.name) ||
        orderListParseChannelOrderFromLabel(order?.customer_name);
      if (fromLabel && !orderListIsInternalDeliveryMetaId(fromLabel)) ext = fromLabel;
    }
    const phone = order?.phone ?? order?.customer_phone ?? '';
    const posNum = order?.order_number ?? order?.number;
    return formatOnlinePanelDisplayId(ext || undefined, phone, posNum);
  };

  const orderListGetDeliveryMeta = (order: any) => {
      const labelSource = String(
        order?.name ||
        order?.customer_name ||
        order?.customerName ||
        ''
      ).trim();
      const inferredCompany =
        /ubereats|uber eats|^uber\b/i.test(labelSource) ? 'UBEREATS' :
        /doordash|door dash|^ddash\b/i.test(labelSource) ? 'DOORDASH' :
        /skipthedishes|^skip\b/i.test(labelSource) ? 'SKIPTHEDISHES' :
        /fantuan/i.test(labelSource) ? 'FANTUAN' :
        /grubhub/i.test(labelSource) ? 'GRUBHUB' :
        '';
      const sidRaw = order?.sourceIds?.channel ?? order?.fullOrder?.sourceIds?.channel;
      let fromSourceIds = '';
      if (sidRaw != null && String(sidRaw).trim() !== '') {
        const ns = String(sidRaw).trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (ns === 'ubereats' || ns === 'uber') fromSourceIds = 'UBEREATS';
        else if (ns === 'doordash' || ns === 'ddash') fromSourceIds = 'DOORDASH';
        else if (ns === 'skipthedishes' || ns === 'skip') fromSourceIds = 'SKIPTHEDISHES';
        else if (ns === 'fantuan') fromSourceIds = 'FANTUAN';
        else if (ns === 'grubhub') fromSourceIds = 'GRUBHUB';
      }
      /** SQLite `orders.channel` 등 — 슬러그(ubereats) → delivery_company와 동일 토큰 */
      const chCol = order?.channel;
      let fromSqliteChannel = '';
      if (chCol != null && String(chCol).trim() !== '') {
        const ns = String(chCol).trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (ns === 'ubereats' || ns === 'uber') fromSqliteChannel = 'UBEREATS';
        else if (ns === 'doordash' || ns === 'ddash') fromSqliteChannel = 'DOORDASH';
        else if (ns === 'skipthedishes' || ns === 'skip') fromSqliteChannel = 'SKIPTHEDISHES';
        else if (ns === 'fantuan') fromSqliteChannel = 'FANTUAN';
        else if (ns === 'grubhub') fromSqliteChannel = 'GRUBHUB';
        else fromSqliteChannel = String(chCol).trim().toUpperCase().replace(/\s+/g, '');
      }
      /** 1순위: `delivery_company`(SQLite/API). 비었을 때만 Firestore·슬러그·이름 추론 (order_source는 배지에 쓰지 않음) */
      const dcPrimary = String(order?.delivery_company ?? order?.deliveryCompany ?? '').trim();
      const company =
        dcPrimary ||
        fromSourceIds ||
        fromSqliteChannel ||
        inferredCompany ||
        '';
      let orderNumber =
        order?.external_order_number ||
        order?.externalOrderNumber ||
        order?.deliveryOrderNumber ||
        order?.delivery_order_number ||
        '';
      if (!orderNumber) {
        orderNumber =
          orderListParseChannelOrderFromLabel(order?.customer_name) ||
          orderListParseChannelOrderFromLabel(order?.name) ||
          '';
      }
      return { company, orderNumber };
    };

  const orderListNormalizeChannelToken = (value: any) =>
    String(value || '').toUpperCase().replace(/[\s_-]+/g, '');

  const orderListGetPickupChannel = (order: any): 'delivery' | 'online' | 'togo' | 'other' => {
      const base = order?.fullOrder || order || {};
      const typeToken = orderListNormalizeChannelToken(
        base?.type || base?.order_type || base?.orderType || order?.type || order?.order_type || order?.orderType
      );
      const sourceToken = orderListNormalizeChannelToken(
        base?.order_source ||
        base?.orderSource ||
        base?.delivery_company ||
        base?.deliveryCompany ||
        order?.order_source ||
        order?.orderSource ||
        order?.delivery_company ||
        order?.deliveryCompany
      );
      const fulfillmentToken = orderListNormalizeChannelToken(
        base?.fulfillment || base?.fulfillment_mode || order?.fulfillment || order?.fulfillment_mode
      );
      const tableId = String(
        base?.tableId || base?.table_id || order?.tableId || order?.table_id || ''
      ).toUpperCase();
      const { company } = orderListGetDeliveryMeta(base);
      const companyToken = orderListNormalizeChannelToken(company);
      const displayName = String(
        base?.name ||
        base?.customer_name ||
        base?.customerName ||
        order?.name ||
        order?.customer_name ||
        order?.customerName ||
        ''
      ).toLowerCase().trim();
      const deliveryTokens = ['DELIVERY', 'UBEREATS', 'UBER', 'DOORDASH', 'SKIP', 'SKIPTHEDISHES', 'FANTUAN', 'GRUBHUB'];
      const onlineTokens = ['ONLINE', 'WEB', 'QR'];
      const togoTokens = ['TOGO', 'TAKEOUT', 'PICKUP'];

      if (
        fulfillmentToken === 'DELIVERY' ||
        tableId.startsWith('DL') ||
        deliveryTokens.includes(typeToken) ||
        deliveryTokens.includes(sourceToken) ||
        deliveryTokens.includes(companyToken) ||
        !!(base?.deliveryCompany || base?.delivery_company || order?.deliveryCompany || order?.delivery_company) ||
        displayName.startsWith('ubereats #') ||
        displayName.startsWith('doordash #') ||
        displayName.startsWith('skip') ||
        displayName.startsWith('fantuan #') ||
        displayName.startsWith('grubhub #')
      ) {
        return 'delivery';
      }

      // 명시 투고/테이블 TG는 OL 접두(가상 테이블)보다 우선 — 투고가 온라인으로 묻는 현상 방지
      if (
        fulfillmentToken === 'TOGO' ||
        tableId.startsWith('TG') ||
        togoTokens.includes(typeToken) ||
        togoTokens.includes(sourceToken)
      ) {
        return 'togo';
      }

      if (
        fulfillmentToken === 'ONLINE' ||
        tableId.startsWith('OL') ||
        onlineTokens.includes(typeToken) ||
        onlineTokens.includes(sourceToken)
      ) {
        return 'online';
      }

      if (fulfillmentToken === 'PICKUP') {
        return 'togo';
      }

      return 'other';
    };

  const isRightPanelDeliveryOrder = (order: any): boolean => {
      return orderListGetPickupChannel(order) === 'delivery';
    };

  const orderListGetTableOrCustomer = (order: any) => {
      const parts: string[] = [];
      const type = (order.order_type || '').toUpperCase();
      const fulfillment = String(order.fulfillment_mode || '').toLowerCase();
      const isDelivery = type === 'DELIVERY' || fulfillment === 'delivery';
      if (isDelivery) {
        const { company, orderNumber: extNum } = orderListGetDeliveryMeta(order);
        const abbr = orderListNormalizeDeliveryAbbr(company);
        const extClean = String(extNum || '').replace(/^#/, '').trim().toUpperCase();
        if (abbr || extClean) {
          parts.push(`${abbr || 'Delivery'} / ${extClean || '-'}`);
        }
      } else {
        const tableName = order.table_name || '';
        if (tableName) {
          parts.push(`Table ${tableName}`);
        } else if (order.table_id) {
          parts.push(`Table ${order.table_id}`);
        }
      }
      if (order.customer_name) parts.push(order.customer_name);
      if (order.customer_phone) parts.push(order.customer_phone);
      return parts.length > 0 ? parts.join(' / ') : '-';
    };

  // ì±„ë„ ë ì§€ (badge) ì •ë³´ ë°˜í™˜
  const orderListGetChannelBadge = (order: any): { label: string; bgColor: string; textColor: string } => {
    const channel = orderListGetPickupChannel(order);

    if (channel === 'online') {
      return { label: 'ONLINE', bgColor: 'bg-violet-600', textColor: 'text-white' };
    }

    if (channel === 'delivery') {
      const { company } = orderListGetDeliveryMeta(order);
      const abbr = orderListNormalizeDeliveryAbbr(company);
      const deliveryLabel = abbr || 'DLV';
      return { label: deliveryLabel, bgColor: 'bg-red-600', textColor: 'text-white' };
    }

    if (channel === 'togo') {
      return { label: 'TOGO', bgColor: 'bg-emerald-600', textColor: 'text-white' };
    }

    const normalizedType = orderListNormalizeChannelToken(order?.order_type);
    if (normalizedType && normalizedType !== 'DINEIN' && normalizedType !== 'POS') {
      return { label: 'TOGO', bgColor: 'bg-emerald-600', textColor: 'text-white' };
    }
    
    if (serviceMode === 'FSR') {
      return { label: 'DINE-IN', bgColor: 'bg-blue-600', textColor: 'text-white' };
    }
    return { label: 'EAT IN', bgColor: 'bg-amber-600', textColor: 'text-white' };
  };

  const orderListCalculateTotals = () => {
      const order = orderListSelectedOrder as any;
      let pmAdjustments: any[] = [];
      try {
        const adjRaw = order?.adjustments_json;
        if (adjRaw) {
          pmAdjustments = typeof adjRaw === 'string' ? JSON.parse(adjRaw) : adjRaw;
          if (!Array.isArray(pmAdjustments)) pmAdjustments = [];
        }
      } catch { pmAdjustments = []; }
      const pmDiscount = pmAdjustments.find((a: any) => a.percent > 0 && a.originalSubtotal > 0);

      try {
        const items = orderListSelectedItems || [];
        const subtotal = items.reduce((sum: number, it: any) => sum + ((it.price || 0) * (it.quantity || 1)), 0);

        const taxByName: Record<string, number> = {};
        items.forEach((it: any) => {
          const itemTotal = (it.price || 0) * (it.quantity || 1);
          const details = it.taxDetails || it.tax_details;
          if (Array.isArray(details) && details.length > 0) {
            details.forEach((td: any) => {
              const name = td.name || 'Tax';
              const rate = Number(td.rate || 0);
              const pct = rate > 1 ? rate / 100 : rate;
              const taxAmt = Number((itemTotal * pct).toFixed(2));
              taxByName[name] = (taxByName[name] || 0) + taxAmt;
            });
          } else if (it.taxRate > 0) {
            const pct = it.taxRate > 1 ? it.taxRate / 100 : it.taxRate;
            const taxAmt = Number((itemTotal * pct).toFixed(2));
            taxByName['Tax'] = (taxByName['Tax'] || 0) + taxAmt;
          }
        });

        const taxLines = Object.entries(taxByName).map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }));
        const taxTotal = Number(taxLines.reduce((s, tl) => s + tl.amount, 0).toFixed(2));

        let discountTotal = 0;
        let netSubtotal = subtotal;
        if (pmDiscount) {
          const origSub = Number((pmDiscount.originalSubtotal || 0).toFixed(2));
          discountTotal = Math.abs(Number(pmDiscount.amount || 0));
          netSubtotal = Number((origSub - discountTotal).toFixed(2));
          const discTaxLines = taxLines.map(tl => ({
            name: tl.name,
            amount: Number((tl.amount * (netSubtotal / origSub)).toFixed(2)),
          }));
          const discTaxTotal = Number(discTaxLines.reduce((s, tl) => s + tl.amount, 0).toFixed(2));
          return {
            subtotal: origSub,
            discountTotal,
            subtotalAfterDiscount: netSubtotal,
            tax: discTaxTotal,
            taxLines: discTaxLines,
            total: Number((netSubtotal + discTaxTotal).toFixed(2)),
            promotionName: pmDiscount.label || `Discount (${pmDiscount.percent}%)`,
          };
        }
        return {
          subtotal: netSubtotal,
          discountTotal: 0,
          subtotalAfterDiscount: netSubtotal,
          tax: taxTotal,
          taxLines,
          total: Number((netSubtotal + taxTotal).toFixed(2)),
          promotionName: '',
        };
      } catch {
        return { subtotal: 0, discountTotal: 0, subtotalAfterDiscount: 0, tax: 0, taxLines: [] as Array<{ name: string; amount: number }>, total: 0, promotionName: '' };
      }
    };

  const orderListGetDaysInMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const days: (Date | null)[] = [];
      
      // Add empty slots for days before first day of month
      for (let i = 0; i < firstDay.getDay(); i++) {
        days.push(null);
      }
      
      // Add all days of the month
      for (let d = 1; d <= lastDay.getDate(); d++) {
        days.push(new Date(year, month, d));
      }
      
      return days;
    };

  const orderListHandleCalendarDateSelect = (date: Date) => {
      const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      setOrderListDate(dateStr);
      setShowOrderListCalendar(false);
      setOrderListSelectedOrder(null);
      setOrderListSelectedItems([]);
      fetchOrderList(dateStr);
  };

  /**
   * âš ï¸ PROTECTED FUNCTION - Table Move/Merge Operations âš ï¸
   * 
   * ê¸°ì¡´ í…Œì´ë¸” ì´ë™/ë³‘í•© ê¸°ëŠ¥ì„ ìœ ì§€í•˜ë©´ì„œ ê°€ìƒ ì£¼ë¬¸ ì„ íƒ íë¦„ê³¼ í†µí•©í•©ë‹ˆë‹¤.
   */
  const handleMoveMergeTableClick = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    
    // Togo/Online → í…Œì´ë¸” ì´ë™/ë¨¸ì§€
    if (sourceTogoOrder || sourceOnlineOrder) {
      const sourceOrder = sourceTogoOrder || sourceOnlineOrder;
      const sourceType = sourceTogoOrder ? 'Togo' : 'Online';
      const sourceLabel = sourceTogoOrder 
        ? `Togo #${sourceTogoOrder.id}`
        : `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
      
      // Online ì£¼ë¬¸ì€ localOrderId (SQLite ID) ì‚¬ìš©, TogoëŠ” ê·¸ëƒ¥ id ì‚¬ìš©
      // ìš°ì„ ìˆœìœ„: localOrderId > fullOrder.localOrderId > number (ìˆ«ìžì¸ ê²½ìš°) > id
      const sourceOrderId = sourceTogoOrder 
        ? sourceTogoOrder.id 
        : (sourceOnlineOrder?.localOrderId || 
           sourceOnlineOrder?.fullOrder?.localOrderId || 
           (typeof sourceOnlineOrder?.number === 'number' ? sourceOnlineOrder.number : null) ||
           sourceOnlineOrder?.id);
      
      console.log('[handleMoveMergeTableClick] Online sourceOrderId:', sourceOrderId, 
        'localOrderId:', sourceOnlineOrder?.localOrderId,
        'fullOrder.localOrderId:', sourceOnlineOrder?.fullOrder?.localOrderId,
        'number:', sourceOnlineOrder?.number,
        'id:', sourceOnlineOrder?.id);
      
      // ë”ë¸” í´ë¦­ ë°©ì§€
      if (isMergeInProgress) {
        console.log('[handleMoveMergeTableClick] Merge already in progress, ignoring');
        return;
      }
      
      // Available í…Œì´ë¸” → Move (ì´ë™)
      if (element.status === 'Available') {
        try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Moving ${sourceLabel} → ${tableLabel}...`);
          
          const response = await fetch(`${API_URL}/table-operations/move-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrderId,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            // 1. ì¦‰ì‹œ ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸ (í…Œì´ë¸” ìƒ‰ìƒ ì¦‰ì‹œ ë³€ê²½)
            setTableElements(prev => prev.map(el => {
              if (String(el.id) === String(element.id)) {
                return { ...el, status: 'Occupied', current_order_id: result.newOrderId };
              }
              return el;
            }));
            
            // 2. LocalStorage ë° ì ìœ  ì‹œê°„ ì—…ë°ì´íŠ¸
            const now = Date.now();
            setOccupiedTimestamp(element.id, now); // ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸ (ì¦‰ì‹œ íƒ€ì´ë¨¸ í‘œì‹œ)
            
            try {
              localStorage.setItem(`lastOrderIdByTable_${element.id}`, String(result.newOrderId));
              localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
                tableId: element.id, 
                floor: selectedFloor, 
                status: 'Occupied', 
                ts: now 
              }));
            } catch (e) {
              console.warn('Failed to update localStorage:', e);
            }
            
            // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì¹´ë“œ ì¦‰ì‹œ ì œê±° (API ì‘ë‹µ ê¸°ë‹¤ë¦¬ì§€ ì•Šê³  ì¦‰ê° UI ë°˜ì˜)
            if (sourceOnlineOrder) {
              setOnlineQueueCards(prev => prev.filter(card => card.id !== sourceOnlineOrder.id));
            }
            
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            setIsMergeInProgress(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            loadOnlineOrders(); // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ ì„œë²„ì—ì„œ ìƒˆë¡œê³ ì¹¨
            
            setMoveMergeStatus(`âœ… Moved ${sourceLabel} → ${tableLabel}`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setIsMergeInProgress(false);
            setMoveMergeStatus(`âŒ Move failed: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          setIsMergeInProgress(false);
          console.error(`${sourceType} to Table move error:`, error);
          setMoveMergeStatus(`âŒ Error: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // Occupied ë˜ëŠ” Payment Pending í…Œì´ë¸” → Merge (ë³‘í•©)
      if (element.status === 'Occupied' || element.status === 'Payment Pending') {
        try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${tableLabel}...`);
          
          const response = await fetch(`${API_URL}/table-operations/merge-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrderId,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            setIsMergeInProgress(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            
            // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ë„ ìƒˆë¡œê³ ì¹¨ (ë¨¸ì§€ëœ ì£¼ë¬¸ ì œê±°)
            loadOnlineOrders();
            
            // í…Œì´ë¸”ë§µ ë°ì´í„° ì„œë²„ì—ì„œ ìƒˆë¡œê³ ì¹¨ (ë™ê¸°í™”)
            try {
              const mapRes = await fetch(`${API_URL}/table-map/elements?floor=${selectedFloor}`);
              if (mapRes.ok) {
                const mapData = await mapRes.json();
                if (mapData.elements && mapData.elements.length > 0) {
                  setTableElements(mapData.elements);
                }
              }
            } catch (e) {
              console.error('Failed to refresh table map:', e);
            }
            
            setMoveMergeStatus(`âœ… Merged ${sourceLabel} → ${tableLabel}`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setIsMergeInProgress(false);
            setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          setIsMergeInProgress(false);
          console.error(`${sourceType} to Table merge error:`, error);
          setMoveMergeStatus(`âŒ Error: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // ë‹¤ë¥¸ ìƒíƒœì˜ í…Œì´ë¸”
      setMoveMergeStatus('âŒ Destination table must be Available, Occupied, or Payment Pending.');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    
    // ì²« ë²ˆì§¸ í´ë¦­: ì¶œë°œ í…Œì´ë¸” ì„ íƒ (Occupied ë˜ëŠ” Payment Pending ê°€ëŠ¥)
    if (!sourceTableId) {
      if (element.status !== 'Occupied' && element.status !== 'Payment Pending') {
        setMoveMergeStatus('âŒ Source table must be Occupied or Payment Pending.');
        setTimeout(() => setMoveMergeStatus(''), 3000);
        return;
      }
      setSourceTableId(element.id);
      setMoveMergeStatus(`âœ“ Source: ${tableLabel} → Select destination table`);
      beginSourceSelection(element, tableLabel);
      return;
    }

    // ë‘ ë²ˆì§¸ í´ë¦­: ëª©ì  í…Œì´ë¸” ì„ íƒ
    if (sourceTableId === element.id) {
      setMoveMergeStatus('âŒ Cannot select the same table.');
      setTimeout(() => {
        clearMoveMergeSelection();
        setMoveMergeStatus('');
      }, 2000);
      return;
    }

    if (!selectionChoice) {
      setMoveMergeStatus('Please select guests/items to move first.');
      return;
    }

    // MOVE: Occupied → Available
    if (element.status === 'Available') {
      try {
        setMoveMergeStatus('🔄 Moving table...');
        const response = await fetch(`${API_URL}/table-operations/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromTableId: sourceTableId,
            toTableId: element.id,
            floor: selectedFloor,
            partialSelection:
              selectionChoice && selectionChoice !== 'ALL'
                ? {
                    mode: 'partial',
                    guestNumbers: selectionChoice.guestNumbers,
                    orderItemIds: selectionChoice.orderItemIds,
                    orderLineIds: selectionChoice.orderLineIds,
                  }
                : undefined,
          })
        });

        const result = await response.json();

        if (result.success) {
          const isPartial = Boolean(result.partial);
          const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Available');
          const toStatus = result.toTable?.status || 'Occupied';
          const targetOrderId = result.toTable?.orderId ?? null;
          setMoveMergeStatus(result.message ? `âœ… ${result.message}` : `âœ… Table moved: ${sourceTableId} → ${element.text}`);
          
          setTableElements(prev => prev.map(el => {
            if (String(el.id) === String(sourceTableId)) {
              const next = { ...el, status: fromStatus };
              if (fromStatus !== 'Occupied') {
                next.current_order_id = null;
              }
              return next;
            }
            if (String(el.id) === String(element.id)) {
              return { ...el, status: toStatus, current_order_id: targetOrderId ?? el.current_order_id };
            }
            return el;
          }));
          
          // 1. Transfer Data (Only for Full Move)
          if (!isPartial) {
            try {
              const sourceOrderId = localStorage.getItem(`lastOrderIdByTable_${sourceTableId}`);
              if (sourceOrderId) {
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, sourceOrderId);
                console.log(`[MOVE] ì£¼ë¬¸ ID ${sourceOrderId}ë¥¼ í…Œì´ë¸” ${sourceTableId}ì—ì„œ ${element.id}ë¡œ ì´ë™`);
              }
              
              const splitGuests = localStorage.getItem(`splitGuests_${sourceTableId}`);
              if (splitGuests) {
                localStorage.setItem(`splitGuests_${element.id}`, splitGuests);
              }
              
              const voidDisplay = localStorage.getItem(`voidDisplay_${sourceTableId}`);
              if (voidDisplay) {
                localStorage.setItem(`voidDisplay_${element.id}`, voidDisplay);
              }
              
              const paidGuests = localStorage.getItem(`paidGuests_${sourceTableId}`);
              if (paidGuests) {
                localStorage.setItem(`paidGuests_${element.id}`, paidGuests);
              }
              
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                const sourceTime = occupiedTimes[String(sourceTableId)];
                if (sourceTime) {
                  occupiedTimes[String(element.id)] = sourceTime;
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    next[String(element.id)] = sourceTime;
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MOVE] localStorage ì—…ë°ì´íŠ¸ ì‹¤íŒ¨:', e);
            }
          }

          // ALWAYS clean up UI cache for source table to prevent stale data
          try {
            localStorage.removeItem(`splitGuests_${sourceTableId}`);
            localStorage.removeItem(`paidGuests_${sourceTableId}`);
          } catch(e) {}

          // 2. Cleanup Source (Universal)
          if (fromStatus !== 'Occupied') {
            try {
              localStorage.removeItem(`lastOrderIdByTable_${sourceTableId}`);
              localStorage.removeItem(`voidDisplay_${sourceTableId}`);

              // Cleanup occupied time if not transferred (or duplicate safety)
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                if (occupiedTimes[String(sourceTableId)]) {
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MOVE] cleanup failed', e);
            }
          }

          // 3. Cleanup Target/Partial Specifics
          if (isPartial) {
            try {
              // Partial move invalidates split/paid status on target usually
              localStorage.removeItem(`paidGuests_${element.id}`);
              localStorage.removeItem(`splitGuests_${element.id}`);
              
              if (targetOrderId) {
                localStorage.removeItem(`paidGuests_order_${targetOrderId}`);
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, String(targetOrderId));
              } else {
                localStorage.removeItem(`lastOrderIdByTable_${element.id}`);
              }
            } catch (e) {
              console.warn('[MOVE] partial localStorage cleanup failed', e);
            }
          }
          
          try {
            localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
              tableId: element.id, 
              floor: selectedFloor, 
              status: toStatus, 
              ts: Date.now() 
            }));
          } catch {}
          
          setSourceTableId(null);
            setMoveMergeStatus('');
          setIsMoveMergeMode(false);
          clearMoveMergeSelection();
          
          // í…Œì´ë¸” ëª©ë¡ ë‹¤ì‹œ ë¡œë“œ (ì„œë²„ì™€ ë™ê¸°í™”)
          await fetchTableMapData();
        } else {
          console.error('[MOVE] Error details:', result);
          setMoveMergeStatus(`âŒ Move failed: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Move table error:', error);
        setMoveMergeStatus(`âŒ Error: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    }
    // MERGE: Occupied/Payment Pending → Occupied/Payment Pending
    else if (element.status === 'Occupied' || element.status === 'Payment Pending') {
      try {
        setMoveMergeStatus('🔄 Merging tables...');
        const response = await fetch(`${API_URL}/table-operations/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromTableId: sourceTableId,
            toTableId: element.id,
            floor: selectedFloor,
            partialSelection:
              selectionChoice && selectionChoice !== 'ALL'
                ? {
                    mode: 'partial',
                    guestNumbers: selectionChoice.guestNumbers,
                    orderItemIds: selectionChoice.orderItemIds,
                    orderLineIds: selectionChoice.orderLineIds,
                  }
                : undefined,
          })
        });

        const result = await response.json();

        if (result.success) {
          const isPartial = Boolean(result.partial);
          const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Available');
          const toStatus = result.toTable?.status || 'Occupied';
          const targetOrderId = result.toTable?.orderId ?? null;
          setMoveMergeStatus(result.message ? `âœ… ${result.message}` : `âœ… Tables merged: ${sourceTableId} + ${element.text}`);
          
          setTableElements(prev => prev.map(el => {
            if (String(el.id) === String(sourceTableId)) {
              const next = { ...el, status: fromStatus };
              if (fromStatus !== 'Occupied') {
                next.current_order_id = null;
              }
              return next;
            }
            if (String(el.id) === String(element.id)) {
              return { ...el, status: toStatus, current_order_id: targetOrderId ?? el.current_order_id };
            }
            return el;
          }));
          
          // ALWAYS clean up UI cache for source table to prevent stale data
          try {
            localStorage.removeItem(`splitGuests_${sourceTableId}`);
            localStorage.removeItem(`paidGuests_${sourceTableId}`);
          } catch(e) {}

          // 1. Transfer Logic (Full Merge only)
          if (!isPartial) {
            try {
              const sourceOrderId = localStorage.getItem(`lastOrderIdByTable_${sourceTableId}`);
              const targetOrderIdLocal = localStorage.getItem(`lastOrderIdByTable_${element.id}`);
              
              if (sourceOrderId && !targetOrderIdLocal) {
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, sourceOrderId);
                
                const splitGuests = localStorage.getItem(`splitGuests_${sourceTableId}`);
                if (splitGuests) {
                  localStorage.setItem(`splitGuests_${element.id}`, splitGuests);
                }
                
                const voidDisplay = localStorage.getItem(`voidDisplay_${sourceTableId}`);
                if (voidDisplay) {
                  localStorage.setItem(`voidDisplay_${element.id}`, voidDisplay);
                }
                
                const paidGuests = localStorage.getItem(`paidGuests_${sourceTableId}`);
                if (paidGuests) {
                  localStorage.setItem(`paidGuests_${element.id}`, paidGuests);
                }
                
                const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
                const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
                if (occupiedTimesRaw) {
                  const occupiedTimes = JSON.parse(occupiedTimesRaw);
                  const sourceTime = occupiedTimes[String(sourceTableId)];
                  if (sourceTime) {
                    occupiedTimes[String(element.id)] = sourceTime;
                    localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                    
                    setTableOccupiedTimes(prev => {
                      const next = { ...prev };
                      next[String(element.id)] = sourceTime;
                      return next;
                    });
                  }
                }
              }
            } catch (e) {
              console.warn('[MERGE] localStorage ì—…ë°ì´íŠ¸ ì‹¤íŒ¨:', e);
            }
          }

          // 2. Cleanup Source (Universal)
          if (fromStatus !== 'Occupied') {
            try {
              localStorage.removeItem(`lastOrderIdByTable_${sourceTableId}`);
              localStorage.removeItem(`splitGuests_${sourceTableId}`);
              localStorage.removeItem(`voidDisplay_${sourceTableId}`);
              localStorage.removeItem(`paidGuests_${sourceTableId}`);
              
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                if (occupiedTimes[String(sourceTableId)]) {
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MERGE] Source cleanup failed', e);
            }
          }

          // 3. Cleanup Target/Partial
          if (isPartial) {
            try {
              localStorage.removeItem(`splitGuests_${element.id}`);
              localStorage.removeItem(`paidGuests_${element.id}`);
              if (targetOrderId) {
                localStorage.removeItem(`paidGuests_order_${targetOrderId}`);
              }
            } catch (e) {
              console.warn('[MERGE] partial localStorage cleanup failed', e);
            }
          }
          
          try {
            localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
              tableId: element.id, 
              floor: selectedFloor, 
              status: toStatus, 
              ts: Date.now() 
            }));
          } catch {}
          
          setSourceTableId(null);
          setMoveMergeStatus('');
          setIsMoveMergeMode(false);
          clearMoveMergeSelection();
          
          await fetchTableMapData();
        } else {
          console.error('[MERGE] Error details:', result);
          setMoveMergeStatus(`âŒ Merge failed: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Merge table error:', error);
        setMoveMergeStatus(`âŒ Error: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    } else {
      setMoveMergeStatus('âŒ Destination table must be Available, Occupied, or Payment Pending.');
      setTimeout(() => setMoveMergeStatus(''), 2000);
    }
  };

  // Partial Selection Modal Handlers
  const handlePartialModalClose = () => {
    clearMoveMergeSelection();
  };

  const handlePartialModalConfirm = (selection: PartialSelectionPayload | 'ALL') => {
    setIsSelectionModalOpen(false);
    setSelectionChoice(selection);
    
    if (selection === 'ALL') {
      setMoveMergeStatus(`âœ“ [Move All] ${sourceSelectionInfo?.label} → Select destination table`);
    } else {
      const guestCount = selection.guestNumbers?.length || 0;
      const itemCount = (selection.orderItemIds?.length || 0) + (selection.orderLineIds?.length || 0);
      setMoveMergeStatus(`âœ“ [Partial: G${guestCount}/I${itemCount}] ${sourceSelectionInfo?.label} → Select destination table`);
    }
  };

  // ë²„íŠ¼ í´ë¦­ í•¸ë“¤ëŸ¬
  
  // --- Sold Out: load badge count ---
  const loadSoldOutCount = async () => {
    try {
      const mid = String(defaultMenu.menuId || '');
      if (!mid) return;
      const res = await fetch(`${API_URL}/sold-out/${encodeURIComponent(mid)}`);
      if (!res.ok) return;
      const data = await res.json();
      const records = Array.isArray(data?.records) ? data.records : [];
      const itemSet = new Set<string>();
      records.forEach((r: any) => {
        if (String(r.scope) === 'item') {
          itemSet.add(String(r.key_id));
        }
      });
      setSoldOutItems(itemSet);
    } catch {}
  };

  useEffect(() => {
    const timer = setTimeout(() => loadSoldOutCount(), 1000);
    const interval = setInterval(() => loadSoldOutCount(), 60000);
    return () => { clearTimeout(timer); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMenu.menuId]);

  const handleButtonClick = async (buttonName: string) => {
    console.log(`ë²„íŠ¼ í´ë¦­: ${buttonName}`);
    switch (buttonName) {
      case 'Open Till':
        try {
          console.log('Opening cash drawer...');
          const response = await fetch(`${API_URL}/printers/open-drawer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await response.json();
          
          if (result.success) {
            console.log('Cash drawer opened successfully:', result);
            // Optional: Show a brief success message to user
            // alert('Cash drawer opened');
          } else {
            console.error('Failed to open cash drawer:', result);
            alert('Failed to open cash drawer: ' + (result.error || 'Unknown error'));
          }
        } catch (error) {
          console.error('Error opening cash drawer:', error);
          alert('Error opening cash drawer. Check console for details.');
        }
        break;
      case 'Move\nMerge':
        if (!isMoveMergeMode) {
          setIsBillPrintMode(false); // ë‹¤ë¥¸ ëª¨ë“œ ë„ê¸°
          setBillPrintStatus('');
          setIsMoveMergeMode(true);
          setMoveMergeStatus('Select a source to move');
          break;
        }
        setIsMoveMergeMode(false);
        clearMoveMergeSelection();
        setMoveMergeStatus('');
        break;
      case 'Online':
        setOnlineModalTab('preptime');
        setShowPrepTimeModal(true);
        break;
      case 'Order History':
        setOrderListOpenMode('history');
        setOrderListChannelFilter('all');
        setShowOrderListModal(true);
        fetchOrderList(orderListDate, 'history');
        break;
      case 'Reserve':
        console.log('Reservation ë²„íŠ¼ í´ë¦­ë¨, ëª¨ë‹¬ ì—´ê¸°');
        setShowReservationModal(true);
        break;
      case 'Waiting List':
        setShowWaitingModal(true);
        break;
      case 'Gift Card':
        setGiftCardNumber(['', '', '', '']);
        setGiftCardAmount('');
        setGiftCardPaymentMethod('Cash');
        setGiftCardCustomerName('');
        setGiftCardCustomerPhone('');
        setGiftCardBalance(null);
        setGiftCardError('');
        setGiftCardMode('sell');
        setShowGiftCardModal(true);
        break;
      case 'Clock In/Out':
        console.log('Clock In/Out ë²„íŠ¼ í´ë¦­ë¨, ë©”ë‰´ ì—´ê¸°');
        setShowClockInOutMenu(true);
        break;
      case 'Online Order':
        console.log('Online Order ë²„íŠ¼ í´ë¦­ë¨');
        handleNewOnlineClick();
        break;
      case 'Refund':
        console.log('Refund ë²„íŠ¼ í´ë¦­ë¨');
        openRefundModal();
        break;
      case 'Back Office':
        if (isWeb2posDemoBuild()) break;
        navigate('/backoffice/tables');
        break;
      case 'QSR/Cafe':
        console.log('QSR/Cafe ë²„íŠ¼ í´ë¦­ë¨');
        navigate('/qsr');
        break;
      case 'Sold Out':
        navigate('/sales/order', {
          state: {
            soldOutModeFromSales: true,
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
          },
        });
        break;
      case 'Closing':
        console.log('Closing button clicked');
        void (async () => {
          try {
            const list = await clockInOutApi.getClockedInEmployees();
            if (!Array.isArray(list) || list.length === 0) {
              alert(
                'Day Closing requires an active Clock In.\n\nShift Close ends your shift (Clock Out). Please Clock In again before Day Closing.'
              );
              setShowClockInModal(true);
              return;
            }
            setShowClosingModal(true);
          } catch (e) {
            console.error('Clock-in check failed:', e);
            alert('Could not verify clock-in status. Please try again.');
          }
        })();
        break;
      case 'Opening':
        console.log('Opening button clicked');
        setShowOpeningModal(true);
        resetOpeningCashCounts();
        break;
      default:
        console.log(`${buttonName} ë²„íŠ¼ì´ í´ë¦­ë˜ì—ˆìŠµë‹ˆë‹¤.`);
        break;
    }
  };

  // ============ Opening/Closing Functions ============
  const fetchZReportData = async () => {
    setIsLoadingZReport(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/z-report`);
      const result = await response.json();
      if (result.success) {
        setZReportData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch Z-Report:', error);
    } finally {
      setIsLoadingZReport(false);
    }
  };

  const handleOpening = async () => {
    try {
      const response = await fetch(`${API_URL}/daily-closings/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          openingCash: openingCashTotal, 
          cashBreakdown: openingCashCounts,
          openedBy: '' 
        })
      });
      const result = await response.json();
      
      if (result.success) {
        // Print opening report (also opens cash drawer)
        await fetch(`${API_URL}/daily-closings/print-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            openingCash: openingCashTotal, 
            cashBreakdown: openingCashCounts 
          })
        });
        
        localStorage.removeItem('pos_last_closed_date');
        setIsDayClosed(false);
        setShowOpeningModal(false);
        resetOpeningCashCounts();
        try {
          window.dispatchEvent(new CustomEvent('posTakeoutDayOpened', { detail: {} }));
        } catch { /* ignore */ }
      } else {
        alert(result.error || 'Opening failed');
      }
    } catch (error: any) {
      console.error('Opening error:', error);
      alert('Opening failed: ' + error.message);
    }
  };

  // Print Z-Report function
  const handlePrintZReport = async () => {
    try {
      await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          zReportData, 
          closingCash: closingCashTotal, 
          cashBreakdown: closingCashCounts 
        })
      });
    } catch (error: any) {
      console.error('Print Z-Report error:', error);
    }
  };

  const handleClosing = async () => {
    console.log('handleClosing called!', { closingCashTotal, closingCashCounts });
    try {
      const response = await fetch(`${API_URL}/daily-closings/closing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          closingCash: closingCashTotal, 
          cashBreakdown: closingCashCounts,
          closedBy: '' 
        })
      });
      const result = await response.json();
      console.log('Closing API result:', result);
      
      if (result.success) {
        // Print Z-Report when closing
        await handlePrintZReport();
        
        const today = getLocalDateString();
        localStorage.setItem('pos_last_closed_date', today);
        setIsDayClosed(true);
        setShowClosingModal(false);
        resetClosingCashCounts();
        setZReportData(null);
        setClosingStep('report');
        try {
          window.dispatchEvent(new CustomEvent('posTakeoutDayClosed', { detail: { date: today } }));
        } catch { /* ignore */ }
      } else {
        alert(result.error || 'Closing failed');
      }
    } catch (error: any) {
      console.error('Closing error:', error);
      alert('Closing failed: ' + error.message);
    }
  };

  // Refund Functions
  const openRefundModal = async () => {
    setShowRefundModal(true);
    setRefundStep('list');
    setRefundSelectedOrder(null);
    setRefundOrderItems([]);
    setRefundPayments([]);
    setRefundSelectedItems({});
    setRefundType('FULL');
    setRefundPin('');
    setRefundPinError('');
    setRefundReason('');
    setRefundResult(null);
    setRefundCardNumber('');
    setRefundApprovalNumber('');
    setRefundGiftCardNumber('');
    setRefundPendingData(null);
    
    // Fetch tax rate from database
    try {
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      if (Array.isArray(taxes) && taxes.length > 0) {
        // Find active taxes and sum their rates
        const activeTaxes = taxes.filter((t: any) => !t.is_deleted);
        if (activeTaxes.length > 0) {
          // Use the first tax rate (usually the main tax like HST)
          const firstTax = activeTaxes[0];
          const rate = parseFloat(firstTax.rate) || 0;
          // If rate > 1, it's stored as percentage (5), convert to decimal (0.05)
          const finalRate = rate > 1 ? rate / 100 : rate;
          setRefundTaxRate(finalRate);
          console.log('Tax:', firstTax.name, 'Rate:', rate, '-> Final rate:', finalRate);
        } else {
          setRefundTaxRate(0.05); // Default 5%
        }
      } else {
        setRefundTaxRate(0.05); // Default 5%
      }
    } catch (e) {
      console.error('Failed to fetch tax rate:', e);
      setRefundTaxRate(0.05); // Default fallback 5%
    }
    
    await fetchPaidOrders();
  };

  const fetchPaidOrders = async (dateOverride?: string, showLoading: boolean = true) => {
    try {
      if (showLoading) setRefundLoading(true);
      const params = new URLSearchParams();
      const searchDate = dateOverride !== undefined ? dateOverride : refundSearchDate;
      if (searchDate) params.append('date', searchDate);
      if (refundSearchText) params.append('search', refundSearchText);
      
      const response = await fetch(`${API_URL}/refunds/paid-orders?${params.toString()}`);
      const data = await response.json();
      if (data.success) {
        setRefundPaidOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Failed to fetch paid orders:', error);
    } finally {
      if (showLoading) setRefundLoading(false);
    }
  };

  const selectOrderForRefund = async (order: any) => {
    try {
      setRefundLoading(true);
      const response = await fetch(`${API_URL}/refunds/order/${order.id}`);
      const data = await response.json();
      if (data.success) {
        setRefundSelectedOrder({ 
          ...order, 
          ...data.order, 
          totalPaid: data.totalPaid, 
          totalRefunded: data.totalRefunded, 
          refundableAmount: data.refundableAmount,
          totalAdjustments: data.totalAdjustments || 0
        });
        setRefundOrderItems(data.items || []);
        setRefundPayments(data.payments || []);
        setRefundStep('detail');
        
        // Calculate actual items subtotal (for proportional refund calculation)
        // Only count positive price items - negative prices are discounts
        const items = data.items || [];
        const itemsSubtotal = items.reduce((sum: number, item: any) => {
          const price = item.unit_price || item.price || 0;
          const qty = item.quantity || 1;
          return sum + (price > 0 ? price * qty : 0);  // Only positive prices
        }, 0);
        
        // Store for proportional calculation
        setRefundSelectedOrder((prev: any) => ({ ...prev, itemsSubtotal }));
        
        // Default to full refund with all items selected (only positive price items)
        const allItems: { [key: number]: number } = {};
        items.forEach((item: any) => {
          const price = item.unit_price || item.price || 0;
          if (item.refundable_quantity > 0 && price > 0) {
            allItems[item.id] = item.refundable_quantity;
          }
        });
        setRefundSelectedItems(allItems);
        setRefundType('FULL');
      }
    } catch (error) {
      console.error('Failed to fetch order details:', error);
    } finally {
      setRefundLoading(false);
    }
  };

  const toggleRefundItem = (itemId: number, maxQty: number) => {
    setRefundSelectedItems(prev => {
      const newItems = { ...prev };
      if (newItems[itemId]) {
        delete newItems[itemId];
      } else {
        newItems[itemId] = maxQty;
      }
      return newItems;
    });
    setRefundType('PARTIAL');
  };

  const updateRefundItemQty = (itemId: number, qty: number) => {
    if (qty <= 0) {
      setRefundSelectedItems(prev => {
        const newItems = { ...prev };
        delete newItems[itemId];
        return newItems;
      });
    } else {
      setRefundSelectedItems(prev => ({ ...prev, [itemId]: qty }));
    }
    setRefundType('PARTIAL');
  };

  const selectAllRefundItems = () => {
    const allItems: { [key: number]: number } = {};
    refundOrderItems.forEach((item: any) => {
      if (item.refundable_quantity > 0) {
        allItems[item.id] = item.refundable_quantity;
      }
    });
    setRefundSelectedItems(allItems);
    setRefundType('FULL');
  };

  const calculateRefundTotals = () => {
    let selectedSubtotal = 0;
    const items: any[] = [];

    // Calculate selected items subtotal (only positive price items)
    refundOrderItems.forEach((item: any) => {
      const qty = refundSelectedItems[item.id] || 0;
      if (qty > 0) {
        const unitPrice = item.unit_price || item.price || 0;
        if (unitPrice > 0) { // Only count positive price items
          const itemTotal = unitPrice * qty;
          selectedSubtotal += itemTotal;
          
          items.push({
            orderItemId: item.id,
            itemName: item.name || item.item_name,
            quantity: qty,
            unitPrice: unitPrice,
            totalPrice: itemTotal,
            tax: 0 // Will be calculated proportionally
          });
        }
      }
    });

    // Calculate total items subtotal (only positive price items)
    const totalItemsSubtotal = refundOrderItems.reduce((sum: number, item: any) => {
      const price = item.unit_price || item.price || 0;
      const qty = item.quantity || 1;
      return sum + (price > 0 ? price * qty : 0);
    }, 0);

    // Calculate proportional refund based on actual paid amount
    const refundableAmount = refundSelectedOrder?.refundableAmount || 0;
    let proportionalRefund = 0;
    
    if (totalItemsSubtotal > 0) {
      // Refund = (selected items / total items) * refundable amount
      proportionalRefund = (selectedSubtotal / totalItemsSubtotal) * refundableAmount;
    }
    
    // Separate into subtotal and tax (estimate based on tax rate)
    const taxRate = refundTaxRate || 0.05;
    const subtotal = proportionalRefund / (1 + taxRate);
    const tax = proportionalRefund - subtotal;
    const total = proportionalRefund;

    // Update item taxes proportionally
    items.forEach(item => {
      item.tax = (item.totalPrice / selectedSubtotal) * tax;
    });

    return { subtotal, tax, total, items };
  };

  const verifyRefundPin = async (pin: string): Promise<{ valid: boolean; employeeName?: string }> => {
    try {
      if (isMasterPosPin(pin)) {
        return { valid: true, employeeName: 'Master PIN' };
      }
      // PINìœ¼ë¡œ ì§ì› ì¡°íšŒ ë° ê¶Œí•œ í™•ì¸ (Manager ë˜ëŠ” Owner)
      const response = await fetch(`${API_URL}/work-schedule/employees`);
      const data = await response.json();
      
      // Handle both response formats: { success: true, employees: [...] } or direct array
      const employees = data.success ? data.employees : (Array.isArray(data) ? data : []);
      
      if (Array.isArray(employees)) {
        // Find employee by PIN (case-insensitive status check)
        const employee = employees.find((emp: any) => {
          const empPin = String(emp.pin || '');
          const inputPin = String(pin || '');
          const empStatus = (emp.status || '').toLowerCase();
          return empPin === inputPin && empStatus === 'active';
        });
        
        if (employee) {
          // Check role (Manager or Owner can process refunds)
          const role = (employee.role || '').toLowerCase();
          const isAuthorized = role.includes('manager') || role.includes('owner') || role.includes('admin');
          
          if (isAuthorized) {
            // Handle both name formats: single 'name' field or separate firstName/lastName
            const employeeName = employee.name || 
              `${employee.firstName || employee.first_name || ''} ${employee.lastName || employee.last_name || ''}`.trim();
            return { valid: true, employeeName };
          } else {
            return { valid: false };
          }
        }
      }
      return { valid: false };
    } catch (error) {
      console.error('PIN verification failed:', error);
      return { valid: false };
    }
  };

  const processRefund = async () => {
    if (!refundPin || refundPin.length < 4) {
      setRefundPinError('PIN Required (min 4 digits)');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    // Verify PIN
    const pinResult = await verifyRefundPin(refundPin);
    if (!pinResult.valid) {
      setRefundPinError('Invalid PIN');
      // Auto clear after 1 second
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    setRefundPinError('');

    const { subtotal, tax, total, items } = calculateRefundTotals();
    
    if (total <= 0) {
      setRefundPinError('Please select items to refund');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    // Determine payment method from original payments
    const paymentMethod = refundPayments.length > 0 ? refundPayments[0].method : 'CASH';
    const normalizedMethod = paymentMethod?.toUpperCase() || 'CASH';

    // Store pending data for later use
    const pendingData = {
      orderId: refundSelectedOrder.id,
      refundType: Object.keys(refundSelectedItems).length === refundOrderItems.filter((i: any) => i.refundable_quantity > 0 && parseFloat(i.price) > 0).length ? 'FULL' : 'PARTIAL',
      items,
      subtotal,
      tax,
      total,
      paymentMethod,
      refundedBy: pinResult.employeeName,
      refundedByPin: refundPin,
      reason: refundReason
    };
    setRefundPendingData(pendingData);

    // Check payment method and route accordingly
    if (normalizedMethod === 'CASH') {
      // Cash: Process immediately
      await executeRefund(pendingData, null, null);
    } else {
      // All card payments (VISA, MASTER, DEBIT, OTHER, GIFT_CARD): Go to card input screen
      setRefundCardNumber('');
      setRefundApprovalNumber('');
      // For Gift Card, pre-fill the card number if available
      if (normalizedMethod === 'GIFT_CARD' || normalizedMethod === 'GIFT CARD' || normalizedMethod === 'GIFT' || normalizedMethod.includes('GIFT')) {
        const gcPayment = refundPayments.find((p: any) => {
          const m = p.method?.toUpperCase() || '';
          return m === 'GIFT_CARD' || m === 'GIFT CARD' || m === 'GIFT' || m.includes('GIFT');
        });
        if (gcPayment && gcPayment.ref) {
          setRefundGiftCardNumber(gcPayment.ref);
        } else {
          setRefundGiftCardNumber('');
        }
      }
      setRefundStep('card_input');
    }
  };

  // Execute the actual refund API call
  const executeRefund = async (pendingData: any, cardInfo: { cardNumber?: string; approvalNumber?: string } | null, giftCardNumber: string | null) => {
    setRefundLoading(true);

    try {
      const response = await fetch(`${API_URL}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingData,
          giftCardNumber,
          cardNumber: cardInfo?.cardNumber,
          approvalNumber: cardInfo?.approvalNumber
        })
      });

      const data = await response.json();
      if (data.success) {
        setRefundResult({
          ...data.refund,
          refundedBy: pendingData.refundedBy,
          originalOrderNumber: refundSelectedOrder.order_number,
          paymentMethod: pendingData.paymentMethod,
          cardNumber: cardInfo?.cardNumber,
          approvalNumber: cardInfo?.approvalNumber
        });
        setRefundStep('confirm');
        
        // Print refund receipt
        await printRefundReceipt({
          ...data.refund,
          refundedBy: pendingData.refundedBy,
          originalOrderNumber: refundSelectedOrder.order_number,
          paymentMethod: pendingData.paymentMethod,
          items: pendingData.items
        });

        // Show success popup
        setShowRefundSuccessPopup(true);
        setTimeout(() => setShowRefundSuccessPopup(false), 2000);
      } else {
        setRefundPinError(data.error || 'Refund failed');
        setTimeout(() => {
          setRefundPinError('');
        }, 2000);
      }
    } catch (error) {
      console.error('Refund processing failed:', error);
      setRefundPinError('Failed to process refund');
      setTimeout(() => {
        setRefundPinError('');
      }, 2000);
    } finally {
      setRefundLoading(false);
    }
  };

  // Process card refund
  const processCardRefund = async () => {
    if (!refundCardNumber || refundCardNumber.length < 4) {
      setRefundPinError('Card number required (last 4 digits)');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    if (!refundApprovalNumber || refundApprovalNumber.length < 4) {
      setRefundPinError('Approval number required');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    await executeRefund(refundPendingData, { cardNumber: refundCardNumber, approvalNumber: refundApprovalNumber }, null);
  };

  // Process gift card refund (reload amount to gift card)
  const processGiftCardRefund = async () => {
    if (!refundGiftCardNumber || refundGiftCardNumber.length < 4) {
      setRefundPinError('Gift card number required');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    await executeRefund(refundPendingData, null, refundGiftCardNumber);
  };

  const printRefundReceipt = async (refundData: any) => {
    try {
      const receiptLines = [
        '========================================',
        '            REFUND RECEIPT',
        '========================================',
        '',
        `Date: ${new Date().toLocaleString()}`,
        `Original Order: #${refundData.originalOrderNumber || refundData.original_order_number}`,
        `Refund ID: #${refundData.id}`,
        `Processed by: ${refundData.refundedBy || refundData.refunded_by}`,
        '',
        '----------------------------------------',
        'REFUNDED ITEMS:',
        '----------------------------------------',
      ];

      if (refundData.items && refundData.items.length > 0) {
        refundData.items.forEach((item: any) => {
          receiptLines.push(`${item.itemName || item.item_name}`);
          receiptLines.push(`  ${item.quantity} x $${(item.unitPrice || item.unit_price || 0).toFixed(2)} = $${(item.totalPrice || item.total_price || 0).toFixed(2)}`);
        });
      }

      receiptLines.push('----------------------------------------');
      receiptLines.push(`Subtotal:        $${(refundData.subtotal || 0).toFixed(2)}`);
      receiptLines.push(`Tax Refund:      $${(refundData.tax || 0).toFixed(2)}`);
      receiptLines.push('========================================');
      receiptLines.push(`TOTAL REFUND:    $${(refundData.total || 0).toFixed(2)}`);
      receiptLines.push('========================================');
      receiptLines.push(`Payment Method: ${refundData.paymentMethod || refundData.payment_method}`);
      if (refundData.reason) {
        receiptLines.push(`Reason: ${refundData.reason}`);
      }
      receiptLines.push('');
      receiptLines.push('        Thank you for your patience');
      receiptLines.push('');
      receiptLines.push('========================================');

      // Send to printer
      await fetch(`${API_URL}/printers/print-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: receiptLines,
          type: 'refund'
        })
      });
    } catch (error) {
      console.error('Failed to print refund receipt:', error);
    }
  };

  const closeRefundModal = () => {
    setShowRefundModal(false);
    setRefundStep('list');
    setRefundSelectedOrder(null);
    setRefundOrderItems([]);
    setRefundPayments([]);
    setRefundSelectedItems({});
    setRefundPin('');
    setRefundPinError('');
    setRefundReason('');
    setRefundResult(null);
  };

  // Gift Card Functions
  const handleGiftCardNumberChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 4);
    const newNumbers = [...giftCardNumber];
    newNumbers[index] = cleaned;
    setGiftCardNumber(newNumbers);
    if (cleaned.length === 4 && index < 3) {
      const nextInput = document.getElementById(`gift-card-input-${index + 1}`);
      nextInput?.focus();
    }
  };

  const getFullGiftCardNumber = () => giftCardNumber.join('');

  const handleSellGiftCard = async () => {
    const cardNum = getFullGiftCardNumber();
    if (cardNum.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    const amount = parseFloat(giftCardAmount);
    if (isNaN(amount) || amount <= 0) {
      setGiftCardError('Please enter a valid amount');
      return;
    }
    if (!giftCardSellerPin || giftCardSellerPin.length < 4) {
      setGiftCardError('Please enter seller PIN (min 4 digits)');
      return;
    }
    setGiftCardError('');

    // ì¶©ì „ ëª¨ë“œì¸ ê²½ìš°
    if (giftCardIsReload) {
      try {
        const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/reload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            payment_method: giftCardPaymentMethod,
            sold_by: 'Staff',
            seller_pin: giftCardSellerPin
          })
        });
        if (response.ok) {
          setShowGiftCardModal(false);
          setShowGiftCardReloadPopup(true);
          setTimeout(() => setShowGiftCardReloadPopup(false), 1000);
          // Reset states
          setGiftCardIsReload(false);
          setGiftCardExistingBalance(null);
          setGiftCardSellerPin('');
        } else {
          const err = await response.json();
          setGiftCardError(err.message || 'Failed to reload gift card');
        }
      } catch (error) {
        setGiftCardError('Failed to connect to server');
      }
      return;
    }

    // ì‹ ê·œ íŒë§¤
    try {
      const response = await fetch(`${API_URL}/gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: cardNum,
          amount: amount,
          payment_method: giftCardPaymentMethod,
          customer_name: giftCardCustomerName || null,
          customer_phone: giftCardCustomerPhone || null,
          sold_by: 'Staff',
          seller_pin: giftCardSellerPin,
          created_at: getLocalDatetimeString()
        })
      });
      if (response.ok) {
        setShowGiftCardModal(false);
        setShowGiftCardSoldPopup(true);
        setTimeout(() => setShowGiftCardSoldPopup(false), 1000);
        setGiftCardSellerPin('');
      } else {
        const err = await response.json();
        // ì¹´ë“œê°€ ì´ë¯¸ ì¡´ìž¬í•˜ë©´ ìžë™ìœ¼ë¡œ ì¶©ì „
        if (err.exists) {
          try {
            const reloadResponse = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/reload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amount,
                payment_method: giftCardPaymentMethod,
                sold_by: 'Staff',
                seller_pin: giftCardSellerPin
              })
            });
            if (reloadResponse.ok) {
              setShowGiftCardModal(false);
              setShowGiftCardReloadPopup(true);
              setTimeout(() => setShowGiftCardReloadPopup(false), 1000);
              setGiftCardSellerPin('');
              setGiftCardIsReload(false);
              setGiftCardExistingBalance(null);
            } else {
              const reloadErr = await reloadResponse.json();
              setGiftCardError(reloadErr.message || 'Failed to reload gift card');
            }
          } catch {
            setGiftCardError('Failed to connect to server');
          }
        } else {
          setGiftCardError(err.message || 'Failed to sell gift card');
        }
      }
    } catch (error) {
      setGiftCardError('Failed to connect to server');
    }
  };

  const handleCheckGiftCardBalance = async () => {
    const cardNum = getFullGiftCardNumber();
    if (cardNum.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    setGiftCardError('');
    setGiftCardBalance(null);
    try {
      const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/balance`);
      if (response.ok) {
        const data = await response.json();
        setGiftCardBalance(data.balance);
      } else {
        setGiftCardError('Gift card not found');
      }
    } catch (error) {
      setGiftCardError('Failed to connect to server');
    }
  };

  // ë²„íŠ¼ ë°ì´í„° (Opening/Closingì€ ìƒíƒœì— ë”°ë¼ ë™ì ìœ¼ë¡œ ë³€ê²½)
  const buttonData = [
    'Open Till',
    'Move\nMerge',
    'Reserve',
    'Waiting List',
    'Gift Card',
    'Online',
    'Order History',
    'Sold Out',
    'Clock In/Out',
    isDayClosed ? 'Opening' : 'Closing'
  ];

  // ê·¸ë¼ë°ì´ì…˜ ìƒ‰ìƒ ìƒì„± í•¨ìˆ˜ (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
  const generateGradientColors = (count: number) => {
    const startColor = '#75A2BF';
    const endColor = '#2F5F8A';
    
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1);
      // ê°„ë‹¨í•œ ìƒ‰ìƒ ë³´ê°„
      const r1 = parseInt(startColor.slice(1, 3), 16);
      const g1 = parseInt(startColor.slice(3, 5), 16);
      const b1 = parseInt(startColor.slice(5, 7), 16);
      
      const r2 = parseInt(endColor.slice(1, 3), 16);
      const g2 = parseInt(endColor.slice(3, 5), 16);
      const b2 = parseInt(endColor.slice(5, 7), 16);
      
      const r = Math.round(r1 + (r2 - r1) * ratio);
      const g = Math.round(g1 + (g2 - g1) * ratio);
      const b = Math.round(b1 + (b2 - b1) * ratio);
      
      colors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
    }
    return colors;
  };

  const gradientColors = generateGradientColors(buttonData.length);
  // ë²„íŠ¼ë³„ ìƒ‰ìƒ ë³´ì •: ì¸ë±ìŠ¤ê°€ ë°”ë€ Waiting List / Sold Outì— ë§žì¶° ì§ì ‘ ì§€ì •
  const getButtonColor = (name: string, index: number) => {
    // if (name === 'Waiting List') return '#2F5F8A';
    return gradientColors[index];
  };

  // Togo ì£¼ë¬¸ ëª¨ë‹¬ ì»´í¬ë„ŒíŠ¸
  const TogoOrderModal = () => {
    if (!showTogoOrderModal) return null;
    const serverSelectionRequired = shouldPromptServerSelection;
    const hasContactInfo = Boolean((customerPhone || '').trim()) || Boolean((customerName || '').trim());
    const canSubmitOrder = !serverSelectionRequired || !!selectedTogoServer;

    const pickupDisplay = formatMinutesToTime(pickupTime);
    const readyTime = readyTimeSnapshot;
    const clampPrepMinutes = (n: number) => Math.max(0, Math.min(1440, n));
    const clampClock = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const sanitizeClockInput = (raw: string, maxDigits: number) => String(raw || '').replace(/[^\d]/g, '').slice(0, maxDigits);
    const computeMinutesUntilClock = (hh: number, mm: number) => {
      const now = new Date();
      const target = new Date(now);
      target.setSeconds(0, 0);
      target.setHours(clampClock(hh, 0, 23), clampClock(mm, 0, 59), 0, 0);
      if (target.getTime() < now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      const diff = Math.round((target.getTime() - now.getTime()) / 60000);
      return { minutes: clampPrepMinutes(diff), target };
    };
    const handleIncrement = (minutes: number) => {
      setPickupTime((prev) => Math.max(0, prev + minutes));
    };
    const handleResetPickup = () => {
      setPickupTime(0);
      setPickupAmPm(getCurrentAmPm());
      setPickupDateLabel(formatPickupDateLabel());
    };
  const handleToggleNoPrep = () => {
    setPrepButtonsLocked((prev) => {
      const next = !prev;
      if (next) {
        handleResetPickup();
      } else {
        setPickupTime(15);
        setPickupAmPm(getCurrentAmPm());
        setPickupDateLabel(formatPickupDateLabel());
      }
      return next;
    });
  };

    const togoFieldRing = (field: 'phone' | 'name' | 'address' | 'note' | 'zip') =>
      togoKeyboardTarget === field ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-[#e0e5ec]' : '';

    return (
      <div className="absolute inset-0 z-40 flex items-start justify-center bg-black bg-opacity-70 p-3 pt-6 sm:p-4">
        <div
          className="flex w-full flex-col overflow-hidden border-0"
          style={{ ...PAY_NEO.modalShell, maxWidth: `${togoModalMaxWidth}px`, height: `${togoModalMaxHeight}px` }}
        >
          <div className="flex flex-shrink-0 items-center justify-between px-5 py-3" style={{ ...PAY_NEO.raised, borderRadius: '16px 16px 0 0' }}>
            <h3 className="text-lg font-extrabold text-slate-800">New Togo</h3>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-4 pb-2 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]" style={{ background: PAY_NEO_CANVAS, overflow: 'visible' }}>
            <div className="min-h-0 space-y-3 overflow-y-auto overflow-x-visible" style={{ overflow: 'visible' }}>
              <div className="grid gap-1.5" style={{ overflow: 'visible' }}>
                <div className="flex flex-col gap-2 md:flex-row" style={{ overflow: 'visible' }}>
                  <div className={`relative rounded-[14px] md:w-[34%] md:flex-none ${togoFieldRing('phone')}`} style={{ overflow: 'visible', zIndex: 100 }} onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => handlePhoneInputChange(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('phone')}
                      ref={phoneInputRef}
                      className="h-10 w-full rounded-[14px] border-0 bg-transparent px-3 text-sm text-gray-900 outline-none focus:ring-0"
                      style={PAY_NEO.inset}
                      placeholder="(000)000-0000"
                    />
                    {renderCustomerSuggestionList('phone')}
                  </div>
                  <div className={`relative rounded-[14px] md:w-[31%] md:flex-none ${togoFieldRing('name')}`} style={{ overflow: 'visible', zIndex: 100 }} onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => handleNameInputChange(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('name')}
                      ref={nameInputRef}
                      className="h-10 w-full rounded-[14px] border-0 bg-transparent px-3 text-sm text-gray-900 outline-none focus:ring-0"
                      style={PAY_NEO.inset}
                      placeholder="Customer name"
                    />
                    {renderCustomerSuggestionList('name')}
                  </div>
                  <div className="flex items-center justify-end md:flex-1">
                    <div
                      className="flex h-10 w-full max-w-[214px] gap-0.5 rounded-[12px] p-1 text-xs font-semibold"
                      style={PAY_NEO.inset}
                      role="group"
                      aria-label="Select order type"
                    >
                      {[
                        { key: 'togo' as const, label: 'TOGO' },
                        { key: 'delivery' as const, label: 'DELIVERY' },
                      ].map((option, idx) => {
                        const active = togoOrderMode === option.key;
                        return (
                          <button
                            type="button"
                            key={option.key}
                            aria-pressed={active}
                            onClick={() => setTogoOrderMode(option.key)}
                            className={`flex h-full items-center justify-center text-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 touch-manipulation hover:brightness-[1.02] ${NEO_MODAL_BTN_PRESS} ${
                              active ? 'font-bold text-slate-800' : 'font-semibold text-slate-600'
                            }`}
                            style={
                              active
                                ? { ...PAY_NEO.inset, flex: idx === 1 ? '0 0 46%' : '0 0 54%' }
                                : { ...PAY_NEO.key, flex: idx === 1 ? '0 0 46%' : '0 0 54%' }
                            }
                          >
                            <span className="mx-auto text-center">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
            </div>
            
              <div className="grid gap-1.5">
                {/* Panel 1: Prep time summary */}
                <div className="rounded-[14px] p-3" style={PAY_NEO.inset}>
                  <div className="flex min-w-0 flex-nowrap items-center gap-2 text-sm font-semibold text-slate-700">
                    <div className="flex min-w-[140px] items-center gap-2">
                      <span className={prepButtonsLocked ? 'text-slate-400' : ''}>Prep Time</span>
                      <span
                        className={`inline-flex items-center rounded-[12px] px-2 py-0.5 font-mono text-3xl font-semibold leading-none ${prepButtonsLocked ? 'text-slate-400' : 'text-indigo-700'}`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, opacity: 0.65 } : PAY_NEO.raised}
                      >
                        {pickupDisplay}
                      </span>
                    </div>
                    <div className="flex min-w-[188px] items-center gap-2 text-sm sm:text-base">
                      <span
                        className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 font-semibold ${prepButtonsLocked ? 'text-slate-400' : 'text-emerald-800'}`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, opacity: 0.65 } : PAY_NEO.key}
                      >
                        Ready {readyTime.readyDisplay}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 font-semibold ${prepButtonsLocked ? 'text-slate-400' : 'text-slate-700'}`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, opacity: 0.65 } : PAY_NEO.key}
                      >
                        Current {readyTime.currentDisplay}
                      </span>
                    </div>
                    <div className="flex-1" />
                  </div>
                </div>

                {/* Panel 2: Minute buttons */}
                <div className="rounded-[14px] p-3" style={PAY_NEO.inset}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap gap-2">
                      {[5, 10, 15, 20, 25].map((min) => (
                        <button
                          type="button"
                          key={`top-${min}`}
                          onClick={() => setPickupTime(min)}
                          disabled={prepButtonsLocked}
                          className={`flex h-[40px] min-w-[70px] items-center justify-center rounded-[10px] border-0 px-3 text-sm font-semibold transition-all touch-manipulation ${NEO_PREP_TIME_BTN_PRESS} ${
                            prepButtonsLocked ? 'cursor-not-allowed' : 'hover:brightness-[1.03]'
                          }`}
                          style={
                            prepButtonsLocked
                              ? { ...PAY_NEO.inset, opacity: 0.45, cursor: 'not-allowed' }
                              : min === 15
                                ? PAY_NEO_PRIMARY_BLUE
                                : PAY_NEO.key
                          }
                        >
                          <span className={prepButtonsLocked ? 'text-slate-500' : min === 15 ? 'text-white' : 'text-slate-800'}>+{min}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[30, 40, 50, 60].map((min) => (
                        <button
                          type="button"
                          key={`bottom-${min}`}
                          onClick={() => setPickupTime(min)}
                          disabled={prepButtonsLocked}
                          className={`flex h-[40px] min-w-[70px] items-center justify-center rounded-[10px] border-0 px-3 text-sm font-semibold transition-all touch-manipulation ${NEO_PREP_TIME_BTN_PRESS} ${
                            prepButtonsLocked ? 'cursor-not-allowed' : 'hover:brightness-[1.03]'
                          }`}
                          style={
                            prepButtonsLocked
                              ? { ...PAY_NEO.inset, opacity: 0.45, cursor: 'not-allowed' }
                              : PAY_NEO.key
                          }
                        >
                          <span className={prepButtonsLocked ? 'text-slate-500' : 'text-slate-800'}>+{min}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleToggleNoPrep}
                        className={`flex h-[40px] w-[75px] items-center justify-center rounded-[10px] border-0 px-4 text-sm font-semibold text-white transition-all touch-manipulation hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS}`}
                        style={prepButtonsLocked ? OH_ACTION_NEO.red : OH_ACTION_NEO.orange}
                      >
                        {prepButtonsLocked ? 'Prep On' : 'Prep Off'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Panel 3: Manual time input */}
                <div className="rounded-[14px] p-3" style={PAY_NEO.inset}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          const cur = parseInt(String(togoReadyHour || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) - 1;
                          setTogoReadyHour(String((next + 24) % 24).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        className={`h-[38px] w-[44px] rounded-[10px] border-0 text-sm font-bold transition-all touch-manipulation ${NEO_MODAL_BTN_PRESS} ${
                          prepButtonsLocked ? 'cursor-not-allowed text-slate-400' : 'text-white hover:brightness-[1.03]'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : OH_ACTION_NEO.blue}
                      >
                        -H
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={togoReadyHour}
                        readOnly
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          openTimePicker('TOGO_HOUR');
                        }}
                        onChange={(e) => {
                          if (prepButtonsLocked) return;
                          const digits = sanitizeClockInput(e.target.value, 2);
                          const n = digits === '' ? NaN : parseInt(digits, 10);
                          if (!Number.isFinite(n)) { setTogoReadyHour(digits); return; }
                          setTogoReadyHour(String(clampClock(n, 0, 23)).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        placeholder="HH"
                        className={`h-[38px] w-[54px] rounded-[14px] border-0 px-2 text-center font-mono text-sm outline-none focus:ring-0 ${
                          prepButtonsLocked ? 'text-slate-400' : 'text-slate-800'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, opacity: 0.55 } : PAY_NEO.inset}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          const cur = parseInt(String(togoReadyHour || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) + 1;
                          setTogoReadyHour(String(next % 24).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        className={`h-[38px] w-[44px] rounded-[10px] border-0 text-sm font-bold transition-all touch-manipulation ${NEO_MODAL_BTN_PRESS} ${
                          prepButtonsLocked ? 'cursor-not-allowed text-slate-400' : 'text-white hover:brightness-[1.03]'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : OH_ACTION_NEO.blue}
                      >
                        +H
                      </button>
                    </div>
                    <span className={prepButtonsLocked ? 'text-slate-400' : 'text-slate-500'}>:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          const cur = parseInt(String(togoReadyMinute || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) - 1;
                          const norm = ((next % 60) + 60) % 60;
                          setTogoReadyMinute(String(norm).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        className={`h-[38px] w-[44px] rounded-[10px] border-0 text-sm font-bold transition-all touch-manipulation ${NEO_MODAL_BTN_PRESS} ${
                          prepButtonsLocked ? 'cursor-not-allowed text-slate-400' : 'text-white hover:brightness-[1.03]'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : OH_ACTION_NEO.emerald}
                      >
                        -M
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={togoReadyMinute}
                        readOnly
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          openTimePicker('TOGO_MINUTE');
                        }}
                        onChange={(e) => {
                          if (prepButtonsLocked) return;
                          const digits = sanitizeClockInput(e.target.value, 2);
                          const n = digits === '' ? NaN : parseInt(digits, 10);
                          if (!Number.isFinite(n)) { setTogoReadyMinute(digits); return; }
                          setTogoReadyMinute(String(clampClock(n, 0, 59)).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        placeholder="MM"
                        className={`h-[38px] w-[54px] rounded-[14px] border-0 px-2 text-center font-mono text-sm outline-none focus:ring-0 ${
                          prepButtonsLocked ? 'text-slate-400' : 'text-slate-800'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, opacity: 0.55 } : PAY_NEO.inset}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (prepButtonsLocked) return;
                          const cur = parseInt(String(togoReadyMinute || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) + 1;
                          const norm = next % 60;
                          setTogoReadyMinute(String(norm).padStart(2, '0'));
                        }}
                        disabled={prepButtonsLocked}
                        className={`h-[38px] w-[44px] rounded-[10px] border-0 text-sm font-bold transition-all touch-manipulation ${NEO_MODAL_BTN_PRESS} ${
                          prepButtonsLocked ? 'cursor-not-allowed text-slate-400' : 'text-white hover:brightness-[1.03]'
                        }`}
                        style={prepButtonsLocked ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : OH_ACTION_NEO.emerald}
                      >
                        +M
                      </button>
                    </div>
                    <div className={`text-xs font-semibold ${prepButtonsLocked ? 'text-slate-400' : 'text-slate-600'}`}>Time (HH:MM)</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <div className={`min-h-[38px] flex-1 rounded-[14px] ${togoFieldRing('address')}`}>
                    <textarea
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('address')}
                      ref={addressInputRef}
                      rows={1}
                      className="min-h-[38px] w-full resize-none rounded-[14px] border-0 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:ring-0"
                      style={PAY_NEO.inset}
                      placeholder="Address"
                    />
                  </div>
                  <div className={`w-24 flex-none rounded-[14px] ${togoFieldRing('zip')}`}>
                    <input
                      type="text"
                      value={customerZip}
                      onChange={(e) => setCustomerZip(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('zip')}
                      ref={zipInputRef}
                      className="h-10 w-full rounded-[14px] border-0 bg-transparent px-3 text-sm text-gray-900 outline-none focus:ring-0"
                      style={PAY_NEO.inset}
                      placeholder="Zip"
                    />
                  </div>
                </div>
            </div>
            
              <div className="grid gap-1.5">
                <div className={`min-h-[38px] rounded-[14px] ${togoFieldRing('note')}`}>
                  <textarea
                    value={togoNote}
                    onChange={(e) => setTogoNote(e.target.value)}
                    onFocus={() => setTogoKeyboardTarget('note')}
                    ref={noteInputRef}
                    rows={1}
                    className="min-h-[38px] w-full resize-none rounded-[14px] border-0 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:ring-0"
                    style={PAY_NEO.inset}
                    placeholder="Note"
                  />
                </div>
            </div>
          </div>
          
            <div className="flex min-h-0 flex-col overflow-hidden rounded-[14px] p-4" style={PAY_NEO.inset}>
              <div className="flex items-center justify-between flex-shrink-0" style={{ marginTop: '-15px' }}>
                <p className="text-base font-semibold text-slate-800">Order History</p>
              </div>
              <div className="overflow-y-auto max-h-28 pr-0.5 flex-shrink-0" style={{ marginTop: '2px' }}>
                {customerHistoryLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : customerHistoryError ? (
                  <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {customerHistoryError}
                  </div>
                ) : displayedHistoryOrders.length === 0 ? (
                  <div className="rounded-[12px] px-3 py-4 text-center text-sm text-slate-500" style={PAY_NEO.inset}>
                    {selectedCustomerHistory ? 'No past orders found.' : 'Select a customer to view history.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {displayedHistoryOrders.map((order) => {
                      const normalized = normalizeOrderId(order.id);
                      const isSelected = normalized != null && normalized === selectedHistoryOrderId;
                      const orderDate = formatOrderHistoryDate(order);
                      const totalValue = formatCurrency(getOrderTotalValue(order));
                      const hStatus = String(order.status || '').toUpperCase();
                      const hIsPaid = hStatus === 'PAID' || hStatus === 'COMPLETED' || hStatus === 'CLOSED' || hStatus === 'PICKED_UP';
                      const hIsPickedUp = hStatus === 'PICKED_UP';
                      const hType = String(order.order_type || order.orderType || '').toUpperCase();
                      const hIsDineIn = hType === 'DINE_IN' || hType === 'DINE-IN' || hType === 'POS';
                      const hLabel = hIsDineIn ? null : !hIsPaid ? 'Unpaid' : (hIsPaid && !hIsPickedUp) ? 'Ready' : null;
                      return (
                        <div key={`${order.id}-${order.number}`}>
            <button
                          type="button"
                          onClick={() => normalized != null && handleHistoryOrderClick(normalized)}
                          className={`w-full rounded-[12px] border-0 px-3 py-2 text-left transition-all touch-manipulation ${NEO_MODAL_BTN_PRESS} ${
                            isSelected
                              ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-[#e0e5ec]'
                              : 'hover:brightness-[1.02]'
                          }`}
                          style={{ paddingTop: '0.55rem', paddingBottom: '0.55rem', ...(isSelected ? PAY_NEO.inset : PAY_NEO.key) }}
                        >
                          <div className="flex items-center justify-between text-[12px] font-semibold text-slate-800 gap-2">
                            <span className="truncate">{orderDate}</span>
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block w-[38px] text-center">
                                {hLabel && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hLabel === 'Unpaid' ? 'text-red-600 bg-red-100' : 'text-emerald-700 bg-emerald-100'}`}>{hLabel}</span>
                                )}
                              </span>
                              <span className="text-sm text-slate-900">{totalValue}</span>
                            </span>
                          </div>
                        </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-3 flex-1 min-h-0 flex flex-col" style={{ marginTop: '-3px' }}>
                <div className="flex flex-col flex-1 min-h-0" style={{ marginTop: '-6px' }}>
                  <div className="flex items-center justify-between flex-shrink-0">
                    <p className="text-sm font-semibold text-slate-800" style={{ marginBottom: '3px' }}>Order Details</p>
                    <div className="text-[11px] text-slate-500 font-semibold">
                      <span
                        className={
                          priceChangeSummary.tone === 'up'
                            ? 'text-rose-600'
                            : priceChangeSummary.tone === 'down'
                            ? 'text-emerald-600'
                            : 'text-slate-500'
                        }
                      >
                        {priceChangeSummary.label}
                      </span>
                      {promotionSummary && (
                        <>
                          <span className="text-slate-400 mx-1">·</span>
                          <span className="text-slate-500 font-normal">{promotionSummary}</span>
                        </>
                      )}
                    </div>
                  </div>
                {historyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : historyError ? (
                    <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">
                      {historyError}
                    </div>
                  ) : historyOrderDetail ? (
                    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px]" style={PAY_NEO.inset}>
                      <div className="flex-1 overflow-y-auto">
                        {historyOrderDetail.items.length === 0 ? (
                          <p className="text-sm text-slate-500 px-3 py-4">No items saved.</p>
                        ) : (
                          historyOrderDetail.items.map((item: any, idx: number) => {
                            const qty = item.quantity || 1;
                            const unitPrice = Number(item.price || item.unit_price || 0);
                            const lineTotal = unitPrice * qty;
                            let rawMods = item.modifiers || [];
                            if (typeof rawMods === 'string') {
                              try { rawMods = JSON.parse(rawMods); } catch { rawMods = []; }
                            }
                            if (!rawMods && item.modifiers_json) {
                              try { rawMods = typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json; } catch { rawMods = []; }
                            }
                            const modifiers: string[] = [];
                            if (Array.isArray(rawMods)) {
                              rawMods.forEach((m: any) => {
                                if (typeof m === 'string') {
                                  modifiers.push(m);
                                } else if (m?.name) {
                                  modifiers.push(m.name);
                                } else if (m?.modifierNames && Array.isArray(m.modifierNames)) {
                                  modifiers.push(...m.modifierNames);
                                } else if (m?.selectedEntries && Array.isArray(m.selectedEntries)) {
                                  m.selectedEntries.forEach((entry: any) => {
                                    if (typeof entry === 'string') modifiers.push(entry);
                                    else if (entry?.name) modifiers.push(entry.name);
                                  });
                                } else if (m?.groupName) {
                                  modifiers.push(m.groupName);
                                }
                              });
                            }
                            let itemDiscountLabel = '';
                            try {
                              const dRaw = item.discount_json || item.discount;
                              const dObj = typeof dRaw === 'string' ? JSON.parse(dRaw) : dRaw;
                              if (dObj && (dObj.percent || dObj.amount || dObj.value)) {
                                if (dObj.percent) itemDiscountLabel = `${dObj.percent}% off`;
                                else if (dObj.amount) itemDiscountLabel = `-${formatCurrency(dObj.amount)}`;
                                else if (dObj.value) itemDiscountLabel = `-${formatCurrency(dObj.value)}`;
                              }
                            } catch {}
                            const noteText = item.note || (typeof item.memo === 'string' ? item.memo : item.memo?.text) || item.specialRequest;
                            return (
                              <div key={item.order_line_id || `${item.id}-${idx}`} className="px-3 py-[3px] text-sm text-slate-700">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold truncate">{item.name}</div>
                                    {(modifiers.length > 0 || noteText || itemDiscountLabel) && (
                                      <div className="text-[11px] text-slate-500 space-y-0.5 mt-[2px]">
                                        {modifiers.length > 0 && <div>· {modifiers.join(', ')}</div>}
                                        {noteText && <div>· {noteText}</div>}
                                        {itemDiscountLabel && <div className="text-rose-500 font-semibold">· {itemDiscountLabel}</div>}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-center text-xs text-slate-500 w-12">{qty}</div>
                                  <div className="text-right font-semibold text-sm w-20">{formatCurrency(lineTotal)}</div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {/* Order Summary: Subtotal, Discounts, Adjustments, Gratuity, Tax, Total */}
                      {(() => {
                        const ho = historyOrderDetail.order;
                        if (!ho) return null;
                        const itemsSubtotal = historyOrderDetail.items.reduce((s: number, it: any) => s + (Number(it.price || it.unit_price || 0) * (it.quantity || 1)), 0);
                        const orderSubtotal = Number(ho.subtotal || 0);
                        const subtotal = orderSubtotal > 0 ? orderSubtotal : itemsSubtotal;
                        const tax = Number(ho.tax || 0);
                        const serviceCharge = Number(ho.service_charge || 0);
                        const total = Number(ho.total || 0);
                        let adjRaw = ho.adjustments_json;
                        if (typeof adjRaw === 'string') { try { adjRaw = JSON.parse(adjRaw); } catch { adjRaw = []; } }
                        const adjustments: any[] = Array.isArray(adjRaw) ? adjRaw : [];
                        const orderAdjustments = Array.isArray(historyOrderDetail.adjustments) ? historyOrderDetail.adjustments : [];
                        const allAdj = [...adjustments, ...orderAdjustments.filter((a: any) => !adjustments.some((b: any) => b.label === a.label && Math.abs(Number(b.amount || b.amountApplied || b.amount_applied || 0)) === Math.abs(Number(a.amount_applied || a.amountApplied || a.amount || 0))))];
                        const hasDiscount = allAdj.length > 0 || (subtotal > 0 && itemsSubtotal > subtotal);
                        const discountAmount = hasDiscount && itemsSubtotal > subtotal ? itemsSubtotal - subtotal : 0;

                        return (
                          <div className="border-t border-slate-200 px-3 py-2 space-y-[2px] text-sm text-slate-700">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span>{formatCurrency(itemsSubtotal)}</span>
                            </div>
                            {allAdj.map((adj: any, i: number) => {
                              const adjAmount = Number(adj.amount || adj.amountApplied || adj.amount_applied || 0);
                              const adjLabel = adj.label || adj.kind || 'Adjustment';
                              return (
                                <div key={`adj-${i}`} className="flex justify-between text-rose-600">
                                  <span>{adjLabel}</span>
                                  <span>{adjAmount < 0 ? `-${formatCurrency(Math.abs(adjAmount))}` : formatCurrency(adjAmount)}</span>
                                </div>
                              );
                            })}
                            {discountAmount > 0 && allAdj.length === 0 && (
                              <div className="flex justify-between text-rose-600">
                                <span>Discount</span>
                                <span>-{formatCurrency(discountAmount)}</span>
                              </div>
                            )}
                            {serviceCharge > 0 && (
                              <div className="flex justify-between">
                                <span>Gratuity</span>
                                <span>{formatCurrency(serviceCharge)}</span>
                              </div>
                            )}
                            {tax > 0 && (
                              <div className="flex justify-between">
                                <span>Tax</span>
                                <span>{formatCurrency(tax)}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-bold border-t border-slate-300 pt-1 mt-1">
                              <span>Total</span>
                              <span>{formatCurrency(total > 0 ? total : (subtotal + tax + serviceCharge))}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-shrink-0 items-center justify-end gap-3 border-0 px-4 pb-4 pt-2" style={{ background: PAY_NEO_CANVAS }}>
            <button
              type="button"
              onClick={() => {
                setShowTogoOrderModal(false);
                setCustomerName('');
                setCustomerPhone('');
                setCustomerAddress('');
                setCustomerZip('');
                setTogoNote('');
                setTogoOrderMode('togo');
                setPrepButtonsLocked(false);
                setPickupTime(15);
                setPickupAmPm(getCurrentAmPm());
                setPickupDateLabel(formatPickupDateLabel());
                setSelectedTogoServer(null);
              }}
              className={`rounded-[14px] border-0 px-5 py-3 font-bold text-gray-700 transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`}
              style={PAY_NEO.inset}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReorderFromHistory}
              disabled={!selectedHistoryOrderId || reorderLoading}
              className={`rounded-[14px] border-0 px-5 py-3 font-bold text-emerald-800 transition-all hover:brightness-[1.02] touch-manipulation disabled:cursor-not-allowed disabled:opacity-45 ${NEO_MODAL_BTN_PRESS}`}
              style={!selectedHistoryOrderId || reorderLoading ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : PAY_NEO.key}
            >
              {reorderLoading ? 'Reordering...' : 'Reorder'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (serverSelectionRequired && !selectedTogoServer) {
                  alert('Please select a server before creating a Togo order.');
                  return;
                }
                const sanitizedCustomerName = sanitizeDisplayName(customerName);
                const {
                  firstName: customerFirstName,
                  lastName: customerLastName,
                  order: customerNameOrder,
                } = parseCustomerName(sanitizedCustomerName);
                const phoneRaw = getTogoPhoneDigits(customerPhone);
                const selectedServer = selectedTogoServer;
                const clockApplied = applyTogoClockIfProvided();
                const pickupMinutesForOrder = clockApplied?.minutes ?? pickupTime;
                const pickupAmPmForOrder = clockApplied?.ampm ?? pickupAmPm;
                const pickupDateLabelForOrder = clockApplied?.dateLabel ?? pickupDateLabel;
                const readyTimeLabel = clockApplied?.readyDisplay ?? computeReadyDisplayFromNow(pickupMinutesForOrder);
                const createdLocal = getLocalDatetimeString();
                const newOrder = {
                    id: Date.now(),
                  type: togoOrderMode === 'delivery' ? 'Delivery' : 'Togo',
                    time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                  createdAt: createdLocal,
                    phone: customerPhone,
                  phoneRaw,
                  name: sanitizedCustomerName,
                  firstName: customerFirstName,
                  lastName: customerLastName,
                  nameOrder: customerNameOrder,
                  status: 'pending',
                  serverId: selectedServer?.employee_id || null,
                  serverName: selectedServer?.employee_name || '',
                  address: customerAddress,
                  zip: customerZip,
                  note: togoNote,
                  fulfillment: togoOrderMode,
                  pickup: {
                    minutes: pickupMinutesForOrder,
                    ampm: pickupAmPmForOrder,
                    dateLabel: pickupDateLabelForOrder,
                  },
                  readyTimeLabel,
                  virtualChannel: 'togo' as VirtualOrderChannel,
                  virtualTableId: null as string | null,
                  service_pattern: 'TAKEOUT',
                };
                const usedVirtualIds = new Set<string>();
                Object.values(togoOrderMeta).forEach((meta) => {
                  if (meta?.virtualTableId) usedVirtualIds.add(meta.virtualTableId);
                });
                const provisionalVirtualId = allocateVirtualTableId('togo', usedVirtualIds);
                newOrder.virtualTableId = provisionalVirtualId;
                setTogoOrderMeta((prev) => ({
                  ...prev,
                  [String(newOrder.id)]: { virtualTableId: provisionalVirtualId, channel: 'togo' },
                }));
                setTogoOrders((prev) => assignDailySequenceNumbers([...prev, newOrder], 'TOGO'));
                  setShowTogoOrderModal(false);
                  setCustomerName('');
                  setCustomerPhone('');
                setCustomerAddress('');
                setCustomerZip('');
                setTogoNote('');
                setTogoOrderMode('togo');
                setPrepButtonsLocked(false);
                  setPickupTime(15);
                setPickupAmPm(getCurrentAmPm());
                setPickupDateLabel(formatPickupDateLabel());
                setSelectedTogoServer(null);

                navigate('/sales/order', {
                  state: {
                    orderType: 'togo',
                    menuId: defaultMenu.menuId,
                    menuName: defaultMenu.menuName,
                    orderId: newOrder.id,
                    serverId: selectedServer?.employee_id || null,
                    serverName: selectedServer?.employee_name || '',
                    customerName: sanitizedCustomerName,
                    customerPhone,
                    customerAddress,
                    customerZip,
                    customerNote: togoNote,
                    togoFulfillment: togoOrderMode,
                    pickup: newOrder.pickup,
                  },
                });
              }}
              disabled={!canSubmitOrder}
              className={`rounded-[14px] border-0 px-6 py-3 font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation disabled:cursor-not-allowed disabled:opacity-45 disabled:text-slate-500 ${NEO_MODAL_BTN_PRESS}`}
              style={!canSubmitOrder ? { ...PAY_NEO.inset, cursor: 'not-allowed' } : PAY_NEO_PRIMARY_BLUE}
            >
              OK
            </button>
          </div>

          <div className="-mt-[30px] flex-shrink-0 px-2 pb-2" style={{ background: PAY_NEO_CANVAS }}>
            <VirtualKeyboard
              open={showTogoOrderModal}
              onType={handleTogoKeyboardType}
              onBackspace={handleTogoKeyboardBackspace}
              onClear={handleTogoKeyboardClear}
              displayText={keyboardDisplayText}
              keepOpen
              languages={['EN', 'KO']}
              currentLanguage="EN"
              maxWidthPx={keyboardMaxWidth}
              layoutMode="parentFlow"
            />
          </div>
        </div>
      </div>
    );
  };

  // ê²°ì œ ëª¨ë‹¬ ì»´í¬ë„ŒíŠ¸
  const PaymentModal = () => {
    if (!showPaymentModal || !selectedOrder) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-96">
          <h3 className="text-lg font-semibold mb-4">Payment</h3>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-gray-600">Order Type:</span>
              <span className="font-medium">{selectedOrder.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Order Number:</span>
              <span className="font-medium">#{selectedOrder.number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Time:</span>
              <span className="font-medium">{selectedOrder.time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Customer:</span>
              <span className="font-medium">{selectedOrder.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Phone:</span>
              <span className="font-medium">{selectedOrder.phone}</span>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setSelectedOrder(null);
              }}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                try {
                  if (selectedOrder) {
                    // 테이블 상태를 Available로 변경 (Preparing 제거)
                    await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(selectedOrder.tableId))}/status`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'Available' })
                    });
                    
                    // ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸
                    setTableElements(prev => prev.map(el => 
                      String(el.id) === String(selectedOrder.tableId) 
                        ? { ...el, status: 'Available' }
                        : el
                    ));
                    
                    // localStorage ì—…ë°ì´íŠ¸
                    try {
                      localStorage.setItem('lastOccupiedTable', JSON.stringify({
                        tableId: selectedOrder.tableId,
                        floor: selectedFloor,
                        status: 'Available',
                        ts: Date.now()
                      }));
                    } catch {}
                  }
                  
                  console.log('Payment completed:', selectedOrder);
                  setShowPaymentModal(false);
                  setSelectedOrder(null);
                } catch (error) {
                  console.error('Payment completion error:', error);
                  alert('ê²°ì œ ì™„ë£Œ ì²˜ë¦¬ ì¤‘ ì˜¤ë¥˜ê°€ ë°œìƒí–ˆìŠµë‹ˆë‹¤.');
                }
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              Payment Complete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Floor ë³€ê²½ í•¸ë“¤ëŸ¬
  const handleFloorChange = (floor: string) => {
    setSelectedFloor(floor);
    console.log(`Floor changed to: ${floor}`);
    
    // Floor ë³€ê²½ ì‹œ ì¦‰ì‹œ ë°ì´í„° ë¡œë“œ
    const fetchFloorData = async () => {
      try {
        setLoading(true);
        
        // Floor ì´ë¦„ì„ ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©
        const apiFloor = floor;
        
        // í…Œì´ë¸” ìš”ì†Œë“¤ ê°€ì ¸ì˜¤ê¸°
        const elementsResponse = await fetch(`${API_URL}/table-map/elements?floor=${apiFloor}`);
        if (elementsResponse.ok) {
          const elements = await elementsResponse.json();
          // ë°ì´í„° ë³€í™˜: text í•„ë“œë¥¼ getElementDisplayNameìœ¼ë¡œ ì„¤ì •
          const transformedElements = elements.map((element: any) => ({
            ...element,
            text: getElementDisplayName(element)
          }));
          // Normalize: Occupied/Payment Pending without a linked order must NOT happen.
          const normalizedElements = transformedElements.map((el: any) => {
            const st = String(el?.status || 'Available');
            const isOccupiedLike = st === 'Occupied' || st === 'Payment Pending';
            const hasOrderId = el?.current_order_id != null && String(el.current_order_id) !== '';
            if (isOccupiedLike && !hasOrderId) return { ...el, status: 'Available' };
            return el;
          });
          // Optimistically apply last occupied table state (for up to 60s)
          let patchedElements = normalizedElements;
          try {
            const raw = localStorage.getItem('lastOccupiedTable');
            if (raw) {
              const hint = JSON.parse(raw);
              if (hint && hint.floor === apiFloor && Date.now() - (hint.ts || 0) < 60000) {
                patchedElements = normalizedElements.map((el: any) => {
                  if (String(el.id) !== String(hint.tableId)) return el;
                  const hintedStatus = String(hint.status || '');
                  const isOccupiedLike = hintedStatus === 'Occupied' || hintedStatus === 'Payment Pending';
                  const hasOrderId = el?.current_order_id != null && String(el.current_order_id) !== '';
                  if (isOccupiedLike && !hasOrderId) return el;
                  return { ...el, status: hintedStatus || el.status };
                });
              }
            }
          } catch {}
          setTableElements(patchedElements);
          setTableHoldInfo(prev => {
            const ids = Object.keys(prev);
            if (ids.length === 0) return prev;
            const next = { ...prev };
            let changed = false;
            for (const tId of ids) {
              const el = patchedElements.find((e: any) => String(e.id) === tId);
              if (el && el.status === 'Occupied' && el.current_order_id) {
                delete next[tId];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        } else {
          console.warn('í…Œì´ë¸” ìš”ì†Œë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ê¸°ë³¸ê°’ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
          setTableElements([]);
        }

        // í™”ë©´ í¬ê¸° ì„¤ì • ê°€ì ¸ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©)
        const screenResponse = await fetch(`${API_URL}/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
        if (screenResponse.ok) {
          const screen = await screenResponse.json();
          // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í™”ë©´ë¹„/í”½ì…€ì„ ê·¸ëŒ€ë¡œ ì ìš©
          setScreenSize({ 
            width: String(screen.width), 
            height: String(screen.height), 
            scale: screen.scale || 1 
          });
        } else {
          console.warn('í™”ë©´ í¬ê¸°ë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•œ ê¸°ë³¸ê°’(1024x768)ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
          // Auto-detect screen size
          const detectedWidth = window.innerWidth;
          const detectedHeight = window.innerHeight;
          console.log(`🖥️ [Auto-detect] No saved screen size, using current: ${detectedWidth}x${detectedHeight}`);
          setScreenSize({ width: String(detectedWidth), height: String(detectedHeight), scale: 1 });
          
          // Save detected size to DB
          try {
            await fetch(`${API_URL}/table-map/screen-size`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ floor: apiFloor, width: detectedWidth, height: detectedHeight, scale: 1 })
            });
            console.log('✅ [Auto-detect] Screen size saved to database');
          } catch (saveErr) {
            console.warn('⚠️ [Auto-detect] Failed to save screen size:', saveErr);
          }
        }
      } catch (err) {
        console.error('ë°ì´í„° ê°€ì ¸ì˜¤ê¸° ì˜¤ë¥˜:', err);
        setError('ë°ì´í„°ë¥¼ ë¶ˆëŸ¬ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.');
      } finally {
        setLoading(false);
      }
    };

    fetchFloorData();
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">âš ï¸</div>
          <p className="text-xl text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium"
          >
            ë‹¤ì‹œ ì‹œë„
          </button>
        </div>
      </div>
    );
  }

  // === Online/Togo PaymentCompleteModal close handler ===
  const handleOnlineTogoPaymentCompleteClose = async (receiptCount: number) => {
    setShowOnlineTogoPaymentCompleteModal(false);
    
    const completionData = onlineTogoCompletionRef.current;
    if (!completionData) {
      disarmPanelTogoPayKitchenSuppress();
      return;
    }

    try {
    const { orderType: orderTypeFromRef, orderId, orderDetail, paymentOrder, sessionPayments } = completionData;
    const orderType =
      (paymentOrder as any)?.orderType ??
      orderTypeFromRef;
    const completePickupAfterPay =
      !!(paymentOrder as any)?.__completePickupAfterPay ||
      completionData?.completePickupAfterPay === true;
    // IMPORTANT: completionData.sessionPayments is a snapshot taken when payment completed.
    // If tip was added after completion (TipEntryModal / Add Cash Tip), use the latest state.
    const sessionPaymentsFresh = (Array.isArray(onlineTogoSessionPayments) && onlineTogoSessionPayments.length > 0)
      ? onlineTogoSessionPayments
      : (sessionPayments || []);

    const savedSqliteOrderId = onlineTogoSavedOrderIdRef.current;
    const localOrderIdRaw =
      paymentOrder?.localOrderId ??
      paymentOrder?.fullOrder?.localOrderId ??
      orderDetail?.fullOrder?.localOrderId ??
      orderDetail?.localOrderId ??
      null;
    const closeTargetId =
      savedSqliteOrderId != null && Number.isFinite(savedSqliteOrderId)
        ? savedSqliteOrderId
        : localOrderIdRaw != null && String(localOrderIdRaw).trim() !== ''
        ? Number(localOrderIdRaw)
        : NaN;

    const normalizeReceiptModifiers = (rawItem: any) => {
      const mods = rawItem?.modifiers ?? rawItem?.options ?? rawItem?.modifierOptions ?? [];
      if (!Array.isArray(mods)) return [];
      // Online order options format: [{ optionName, choiceName, price }]
      if (mods.length > 0 && typeof mods[0] === 'object' && (mods[0].optionName || mods[0].choiceName)) {
        return [{
          selectedEntries: mods
            .map((o: any) => ({
              name: (o.optionName && o.choiceName) ? `${o.optionName}: ${o.choiceName}` : (o.choiceName || o.optionName || o.name || ''),
              price_delta: Number(o.price || 0)
            }))
            .filter((e: any) => e.name)
        }];
      }
      return mods;
    };

    const normalizeReceiptMemo = (rawItem: any) => {
      try {
        if (rawItem?.memo_json) {
          const memo = (typeof rawItem.memo_json === 'string') ? JSON.parse(rawItem.memo_json) : rawItem.memo_json;
          return memo;
        }
      } catch {}
      return rawItem?.memo ?? rawItem?.memoText ?? rawItem?.note ?? rawItem?.notes ?? rawItem?.specialInstructions ?? '';
    };

    const normalizeReceiptDiscount = (rawItem: any, gross: number) => {
      const d = (rawItem as any)?.discount ?? null;
      if (d && typeof d === 'object') {
        const amt = Number(d.amount ?? d.amount_applied ?? d.discountAmount ?? 0);
        if (amt > 0) return { type: d.type || d.label || 'Discount', value: d.value || 0, amount: amt };
      }
      try {
        const dj = (rawItem as any)?.discount_json;
        if (!dj) return undefined;
        const parsed = (typeof dj === 'string') ? JSON.parse(dj) : dj;
        if (!parsed || typeof parsed !== 'object') return undefined;
        const mode = String(parsed.mode || parsed.type || '').toLowerCase();
        const value = Number(parsed.value ?? parsed.percent ?? parsed.rate ?? 0);
        const amountField = Number(parsed.amount ?? parsed.amountApplied ?? parsed.amount_applied ?? 0);
        let amount = 0;
        if (amountField > 0) amount = amountField;
        else if (mode === 'percent' || mode === 'percentage') amount = gross * (value / 100);
        else if (value > 0) amount = value;
        amount = Number(amount.toFixed(2));
        if (amount > 0) return { type: parsed.type || parsed.label || 'Discount', value, amount };
      } catch {}
      return undefined;
    };

    const normalizeReceiptAdjustments = (rawOrderData: any) => {
      const adjs = Array.isArray(rawOrderData?.adjustments) ? rawOrderData.adjustments : [];
      return adjs.map((a: any) => {
        const kind = String(a.kind || '').toUpperCase();
        const rawAmt = Number(a.amount_applied ?? a.amountApplied ?? a.amount_applied ?? a.amount ?? a.value ?? 0);
        const absAmt = Math.abs(Number(rawAmt || 0));
        if (!(absAmt > 0)) return null;

        const isDiscountLike =
          kind === 'PROMOTION' ||
          kind === 'COUPON' ||
          kind.includes('DISCOUNT') ||
          kind.includes('D/C') ||
          kind === 'DISCOUNT';

        const isFeeLike =
          kind.includes('FEE') ||
          kind.includes('CHARGE') ||
          kind === 'BAG_FEE';

        const signed =
          isDiscountLike ? -absAmt :
          isFeeLike ? absAmt :
          (rawAmt < 0 ? -absAmt : absAmt);

        const label =
          a.label ||
          (kind === 'BAG_FEE' ? 'Bag Fee' : '') ||
          (kind === 'CHANNEL_DISCOUNT' ? 'Discount' : '') ||
          (kind === 'PROMOTION' ? 'Promotion' : '') ||
          kind ||
          'Adjustment';

        return { label: String(label), amount: Number(signed.toFixed(2)) };
      }).filter(Boolean);
    };

    const normalizeReceiptItems = (rawOrderData: any) => {
      const rawItems = rawOrderData?.items || [];
      if (!Array.isArray(rawItems)) return [];
      return rawItems.map((item: any) => {
        const qty = item.quantity || item.qty || 1;
        const basePrice = Number(item.price ?? item.unitPrice ?? item.unit_price ?? item.itemPrice ?? 0);
        const modifiers = normalizeReceiptModifiers(item);
        // Estimate modifier total (best effort, to compute discount percent amounts)
        let modsPerUnit = 0;
        try {
          modifiers.forEach((m: any) => {
            if (m?.selectedEntries && Array.isArray(m.selectedEntries)) {
              m.selectedEntries.forEach((e: any) => { modsPerUnit += Number(e.price_delta || e.priceDelta || e.price || 0); });
            } else if (m && typeof m === 'object') {
              modsPerUnit += Number(m.price || m.price_delta || 0);
            }
          });
        } catch {}
        const memo = normalizeReceiptMemo(item);
        const memoPrice = (memo && typeof memo === 'object') ? Number((memo as any).price || 0) : 0;
        const gross = Number(((basePrice + modsPerUnit + memoPrice) * qty).toFixed(2));
        const discount = normalizeReceiptDiscount(item, gross);
        return {
          name: item.name || item.itemName || '',
          quantity: qty,
          price: basePrice,
          modifiers,
          memo,
          discount
        };
      });
    };
    
    // Kitchen Ticket: SKIP — orders from Pickup List / Order History already had their
    // kitchen ticket printed when the order was originally sent (OK flow).
    // Only Receipt is printed on payment completion from these lists.

    try {
      if (orderType === 'online' && orderId) {
        // Online order: update Firebase status to completed
        const response = await fetch(`${API_URL}/online-orders/order/${orderId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) {
          console.log('Online order status updated to completed');
        } else {
          console.error('Failed to update online order status');
        }
        
        // Print receipts (user-selected count)
        if (receiptCount > 0) {
          try {
            const orderData = orderDetail?.fullOrder || paymentOrder;
            const receiptItems = normalizeReceiptItems(orderData);
            const receiptAdjustments = normalizeReceiptAdjustments(orderData);
            const actualPayments = sessionPaymentsFresh.length > 0
              ? sessionPaymentsFresh.map((p: any) => ({
                  method: p.method,
                  amount: p.amount,
                  tip: p.tip || 0,
                  ...(p.terminalRef ? { ref: p.terminalRef } : {}),
                }))
              : [{ method: 'PAID', amount: paymentOrder.total || 0 }];
            // Change should be calculated from FOOD portion only (amount - tip).
            // This prevents "cash tip" from being misinterpreted as change.
            const cashFoodPaid = sessionPaymentsFresh
              .filter((p: any) => String(p.method || '').toUpperCase() === 'CASH')
              .reduce((s: number, p: any) => s + Math.max(0, (p.amount || 0) - (p.tip || 0)), 0);
            const foodTotal = paymentOrder.total || 0;
            const nonCashFoodPaid = sessionPaymentsFresh
              .filter((p: any) => String(p.method || '').toUpperCase() !== 'CASH')
              .reduce((s: number, p: any) => s + Math.max(0, (p.amount || 0) - (p.tip || 0)), 0);
            const changeAmount = Math.max(0, Number((cashFoodPaid - Math.max(0, foodTotal - nonCashFoodPaid)).toFixed(2)));
            const pmDiscOnline = onlineTogoPaymentCompleteData?.discount;
            let onlineTaxLines: Array<{ name: string; amount: number }> = paymentOrder.tax ? [{ name: 'Tax', amount: paymentOrder.tax }] : [];
            let onlineTaxTotal = paymentOrder.tax || 0;
            let onlineTotal = paymentOrder.total || 0;
            if (pmDiscOnline && pmDiscOnline.percent > 0) {
              receiptAdjustments.push({ label: `Discount (${pmDiscOnline.percent}%)`, amount: -Number(pmDiscOnline.amount.toFixed(2)) });
              onlineTaxLines = pmDiscOnline.taxLines.map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
              onlineTaxTotal = Number(pmDiscOnline.taxesTotal.toFixed(2));
              onlineTotal = Number((pmDiscOnline.discountedSubtotal + pmDiscOnline.taxesTotal).toFixed(2));
            }
            const receiptData = {
              header: {
                orderNumber: paymentOrder.number || paymentOrder.id,
                channel: 'ONLINE',
                tableName: '',
              },
              orderInfo: {
                orderNumber: paymentOrder.number || paymentOrder.id,
                orderType: 'ONLINE',
                channel: 'ONLINE',
                customerName: paymentOrder.name || '',
                customerPhone: paymentOrder.phone || '',
              },
              channel: 'ONLINE',
              items: receiptItems,
              subtotal: paymentOrder.subtotal || 0,
              adjustments: receiptAdjustments,
              taxLines: onlineTaxLines,
              taxesTotal: onlineTaxTotal,
              total: onlineTotal,
              payments: actualPayments,
              change: changeAmount
            };
            await printReceipt(receiptData, receiptCount);
            console.log(`Receipt printed ${receiptCount} copies`);
          } catch (printErr) {
            console.error('Receipt print error:', printErr);
          }
        }

        if (Number.isFinite(closeTargetId)) {
          try {
            const disc = onlineTogoPaymentCompleteData?.discount;
            const closeBody =
              disc && typeof disc === 'object' && Number(disc.percent) > 0
                ? JSON.stringify({ discount: disc })
                : '{}';
            const cr = await fetch(`${API_URL}/orders/${closeTargetId}/close`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: closeBody,
            });
            if (!cr.ok) console.error('Failed to close local order row for ONLINE', closeTargetId);
          } catch (ce) {
            console.error('Close local online order:', ce);
          }
        }
      } else if (orderType === 'delivery') {
        const delCloseId = Number(
          paymentOrder?.order_id ??
            paymentOrder?.localOrderId ??
            paymentOrder?.fullOrder?.localOrderId ??
            closeTargetId
        );
        if (Number.isFinite(delCloseId)) {
          try {
            const disc = onlineTogoPaymentCompleteData?.discount;
            const closeBody =
              disc && typeof disc === 'object' && Number(disc.percent) > 0
                ? JSON.stringify({ discount: disc })
                : '{}';
            const dr = await fetch(`${API_URL}/orders/${delCloseId}/close`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: closeBody,
            });
            if (!dr.ok) console.error('Failed to close local order row for DELIVERY', delCloseId);
          } catch (de) {
            console.error('Close local delivery order:', de);
          }
        }
      } else if (orderType === 'togo' && orderId) {
        // Togo order: update local DB status to PAID
        const response = await fetch(`${API_URL}/orders/${orderId}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) {
          console.log('Togo order status updated to PAID');
        } else {
          console.error('Failed to update Togo order status');
        }
        
        // Print receipts (user-selected count)
        if (receiptCount > 0) {
          try {
            const orderData = orderDetail?.fullOrder || paymentOrder;
            const receiptItems = normalizeReceiptItems(orderData);
            const receiptAdjustments = normalizeReceiptAdjustments(orderData);
            const actualPayments = sessionPaymentsFresh.length > 0
              ? sessionPaymentsFresh.map((p: any) => ({
                  method: p.method,
                  amount: p.amount,
                  tip: p.tip || 0,
                  ...(p.terminalRef ? { ref: p.terminalRef } : {}),
                }))
              : [{ method: 'PAID', amount: paymentOrder.total || 0 }];
            // Change should be calculated from FOOD portion only (amount - tip).
            // This prevents "cash tip" from being misinterpreted as change.
            const cashFoodPaid = sessionPaymentsFresh
              .filter((p: any) => String(p.method || '').toUpperCase() === 'CASH')
              .reduce((s: number, p: any) => s + Math.max(0, (p.amount || 0) - (p.tip || 0)), 0);
            const foodTotal = paymentOrder.total || 0;
            const nonCashFoodPaid = sessionPaymentsFresh
              .filter((p: any) => String(p.method || '').toUpperCase() !== 'CASH')
              .reduce((s: number, p: any) => s + Math.max(0, (p.amount || 0) - (p.tip || 0)), 0);
            const changeAmount = Math.max(0, Number((cashFoodPaid - Math.max(0, foodTotal - nonCashFoodPaid)).toFixed(2)));
            const pmDiscTogo = onlineTogoPaymentCompleteData?.discount;
            let togoTaxLines: Array<{ name: string; amount: number }> = paymentOrder.tax ? [{ name: 'Tax', amount: paymentOrder.tax }] : [];
            let togoTaxTotal = paymentOrder.tax || 0;
            let togoTotal = paymentOrder.total || 0;
            if (pmDiscTogo && pmDiscTogo.percent > 0) {
              receiptAdjustments.push({ label: `Discount (${pmDiscTogo.percent}%)`, amount: -Number(pmDiscTogo.amount.toFixed(2)) });
              togoTaxLines = pmDiscTogo.taxLines.map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
              togoTaxTotal = Number(pmDiscTogo.taxesTotal.toFixed(2));
              togoTotal = Number((pmDiscTogo.discountedSubtotal + pmDiscTogo.taxesTotal).toFixed(2));
            }
            const receiptData = {
              header: {
                orderNumber: paymentOrder.number || paymentOrder.id,
                channel: 'TOGO',
                tableName: '',
              },
              orderInfo: {
                orderNumber: paymentOrder.number || paymentOrder.id,
                orderType: 'TOGO',
                channel: 'TOGO',
                customerName: paymentOrder.name || '',
                customerPhone: paymentOrder.phone || '',
              },
              channel: 'TOGO',
              items: receiptItems,
              subtotal: paymentOrder.subtotal || 0,
              adjustments: receiptAdjustments,
              taxLines: togoTaxLines,
              taxesTotal: togoTaxTotal,
              total: togoTotal,
              payments: actualPayments,
              change: changeAmount
            };
            await printReceipt(receiptData, receiptCount);
            console.log(`Receipt printed ${receiptCount} copies`);
          } catch (printErr) {
            console.error('Receipt print error:', printErr);
          }
        }
      }
    } catch (error) {
      console.error('Payment status update error:', error);
    }
    
    // Remove from order list (온라인 Pay만: 패널 카드 유지 → 아래에서 map 갱신)
    if (paymentOrder) {
      setSelectedOrderDetail(null);
      if (orderType === 'online') {
        if (completePickupAfterPay) {
          setOnlineQueueCards(prev => prev.filter(card => card.id !== paymentOrder.id));
        } else {
          setOnlineQueueCards(prev =>
            prev.map((card) => {
              if (String(card.id) !== String(paymentOrder.id)) return card;
              const fo = { ...(card.fullOrder || {}), status: 'completed', paymentStatus: 'paid' };
              return { ...card, status: 'completed', fullOrder: fo };
            })
          );
        }
      } else if (orderType === 'togo') {
        setTogoOrders(prev => prev.filter(order => order.id !== paymentOrder.id));
      } else if (orderType === 'delivery') {
        const dm = paymentOrder?.deliveryMetaId ?? paymentOrder?.delivery_meta_id;
        setTogoOrders((prev) =>
          (prev || []).filter((order: any) => {
            if (dm != null && String(dm) !== '' && String(order?.deliveryMetaId || order?.delivery_meta_id || '') === String(dm))
              return false;
            if (String(order?.id) === String(paymentOrder?.id)) return false;
            return true;
          })
        );
      }
    }
    
    // Cash drawer는 onPaymentComplete 콜백에서 이미 열었으므로 여기서는 생략
    // (Dine-in도 동일: onPaymentComplete에서 1회만 오픈)
    
    // Auto Pickup Complete — 온라인은 Pay & Pickup일 때만 (Pay만 결제 시 카드·픽업 목록 유지)
    try {
      const orderId = paymentOrder?.id;
      const localOrderId = paymentOrder?.localOrderId || paymentOrder?.fullOrder?.localOrderId;
      if (orderId) {
        if (orderType === 'online') {
          if (completePickupAfterPay) {
            await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
            if (localOrderId) {
              await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'PICKED_UP' }),
              });
            }
          }
        } else if (orderType === 'togo' || orderType === 'pickup') {
          await fetch(`${API_URL}/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PICKED_UP' }),
          });
        } else if (orderType === 'delivery') {
          const actualOrderId = paymentOrder?.order_id || orderId;
          if (Number.isFinite(Number(actualOrderId))) {
            await fetch(`${API_URL}/orders/${actualOrderId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          }
          const deliveryMetaId = paymentOrder?.deliveryMetaId || (typeof paymentOrder?.table_id === 'string' && String(paymentOrder.table_id).toUpperCase().startsWith('DL')
            ? String(paymentOrder.table_id).substring(2)
            : null);
          if (deliveryMetaId != null && String(deliveryMetaId).trim() !== '') {
            await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(String(deliveryMetaId))}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          }
        }
      }
    } catch (pickupErr) {
      console.error('Auto pickup complete error:', pickupErr);
    }

    // Ensure we return to TableMap immediately
    setShowOrderDetailModal(false);
    setSelectedOrderDetail(null);
    setSelectedOrderType(null);
    
    setOnlineTogoPaymentOrder(null);
    setOnlineTogoSessionPayments([]);
    onlineTogoSavedOrderIdRef.current = null;
    onlineTogoCompletionRef.current = null;
    setOnlineTogoPaymentCompleteData(null);

    // orderPaid 리스너가 곧바로 loadTogoOrders()를 호출하므로, 반드시 그보다 먼저 숨김 키를 등록해야 카드가 부활하지 않음
    const dmHide =
      paymentOrder?.deliveryMetaId ??
      paymentOrder?.delivery_meta_id ??
      (typeof paymentOrder?.table_id === 'string' && String(paymentOrder.table_id).toUpperCase().startsWith('DL')
        ? String(paymentOrder.table_id).substring(2)
        : null);
    if (!(orderType === 'online' && !completePickupAfterPay)) {
      registerSwipeRemovedPanelIds(
        paymentOrder?.id,
        orderId,
        orderDetail?.fullOrder?.id,
        closeTargetId,
        localOrderIdRaw,
        savedSqliteOrderId,
        paymentOrder?.order_id,
        (paymentOrder as any)?.onlineOrderNumber,
        (orderDetail?.fullOrder as any)?.onlineOrderNumber,
        dmHide
      );
    }

    // orderPaid는 loadTogoOrders만 호출 — 온라인 큐는 여기서 즉시 갱신
    void loadOnlineOrders();

    // Notify other components (PickupListPanel, etc.) that payment completed
    window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId: paymentOrder?.id } }));
    window.dispatchEvent(new Event('paymentCompleted'));

    // PATCH/close 반영 전 첫 응답에서 다시 보일 수 있음 — 스와이프 픽업과 동일 지연 후 재동기화
    window.setTimeout(() => {
      void loadOnlineOrders();
      void loadTogoOrders();
    }, 2000);
    } finally {
      disarmPanelTogoPayKitchenSuppress();
      window.setTimeout(() => {
        try { disarmPanelTogoPayKitchenSuppress(); } catch {}
      }, 2500);
    }
  };

  return (
    <div className="min-h-screen bg-white" ref={pageHostRef}>
      {/* ë©”ì¸ ì½˜í…ì¸  ì˜ì—­ (ì „ì²´ë¥¼ ê³ ì • í•´ìƒë„ í”„ë ˆìž„ì— ë‹´ìŒ) */}
      <div className="pb-0 flex items-start justify-center">
        {!frameReady ? (
          <div className="flex items-center justify-center" style={{ width: '100%', height: '70vh' }}>
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-600">í™”ë©´ í¬ê¸° ë¶ˆëŸ¬ì˜¤ëŠ” ì¤‘...</p>
            </div>
          </div>
        ) : (
        <div
          className="relative"
          style={{
            width: `${Math.round(frameWidthPx * scaleFactor)}px`,
            height: `${Math.round(frameHeightPx * scaleFactor)}px`,
          }}
        >
          <div
            ref={fixedAreaRef}
            style={ {
              width: `${frameWidthPx}px`,
              height: `${frameHeightPx}px`,
              transform: `scale(${scaleFactor})`,
              transformOrigin: 'top left'
            }}
            className="bg-gray-100 relative flex flex-col"
            id="pos-canvas-anchor"
          >
          {/* 1. ìƒë‹¨ ë°” (ê³ ì • ë†’ì´) */}
          <div className="h-14 bg-gradient-to-b from-blue-100 to-blue-50 border-b-2 border-blue-300 shadow-lg grid grid-cols-3 items-center px-4">
            <div className="flex min-w-0 space-x-2 h-3/4 items-center">
              {/* Floor íƒ­ - 1Fë§Œ í™œì„±í™” */}
              {floorList.map((floor) => (
                <div key={floor} className="relative">
                  <button
                    className={`w-auto h-10 px-4 py-2 rounded-lg text-sm font-semibold ${
                      floor === '1F' 
                        ? (selectedFloor === floor
                            ? 'bg-indigo-500 text-white'
                            : 'bg-white text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200')
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed border border-gray-200'
                    }`}
                    onClick={() => floor === '1F' && handleFloorChange(floor)}
                    disabled={floor !== '1F'}
                    title={floor === '1F' ? `Floor ${floor}ë¡œ ì „í™˜` : 'ë¹„í™œì„±í™”ë¨'}
                  >
                    {floor}
                  </button>
                </div>
              ))}
              {shouldPromptServerSelection && tableMapHeaderServerName ? (
                <span
                  className="max-w-[min(42vw,14rem)] truncate rounded-md border border-indigo-300/80 bg-white/95 px-2.5 py-1 text-xs font-semibold text-indigo-900 shadow-sm"
                  title={tableMapHeaderServerName}
                >
                  서버: {tableMapHeaderServerName}
                </span>
              ) : null}
            </div>
            {/* Firebase sync 상태 + 현재 시간 (중앙) — 날짜/시간 왼쪽에 동기 pill */}
            <div className="flex min-w-0 justify-center items-center gap-2">
              {networkSync.showAlert && !networkSync.okFlash ? (
                <div
                  className={`pointer-events-auto max-w-[min(40vw,12rem)] shrink-0 rounded-md border px-2 py-0.5 text-left text-[10px] font-medium leading-snug text-white shadow-sm ${
                    networkSync.disconnectedUi
                      ? 'border-amber-800/60 bg-amber-950/92'
                      : networkSync.dlq > 0
                        ? 'border-rose-800/60 bg-rose-950/92'
                        : networkSync.syncActive
                          ? 'border-sky-700/50 bg-sky-950/92'
                          : 'border-slate-700/50 bg-slate-950/90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <div className="font-semibold">{networkSync.title}</div>
                      {networkSync.detail ? (
                        <div className="text-[9px] font-normal leading-tight opacity-85">{networkSync.detail}</div>
                      ) : null}
                    </div>
                    {networkSync.dlq > 0 && networkSync.onOpenDlq ? (
                      <button
                        type="button"
                        className="shrink-0 text-[9px] text-white/90 underline underline-offset-2 hover:text-white"
                        onClick={networkSync.onOpenDlq}
                      >
                        Details
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <span className="truncate text-lg font-bold tracking-wide text-gray-700">{currentTime}</span>
            </div>
            {/* Delivery + TOGO + Online Alert + EXIT 버튼 (오른쪽) */}
            <div className="flex justify-end items-center gap-1.5">
              {fsrTogoButtonVisible && (
                <button
                  className="h-[35px] px-3 flex items-center justify-center text-sm font-bold transition-all duration-150"
                  style={{ borderRadius: '10px', border: 'none', background: '#e0e5ec', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff', color: '#4B5563', cursor: 'pointer' }}
                  onClick={() => { setPickupModalInitialMode('togo'); setShowFsrPickupModal(true); }}
                  title="Togo Order"
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                  onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff'; }}
                  onMouseUp={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                >
                  TOGO
                </button>
              )}
              {fsrTogoButtonVisible && (
                <button
                  className="h-[35px] px-3 flex items-center justify-center text-sm font-bold transition-all duration-150"
                  style={{ borderRadius: '10px', border: 'none', background: '#e0e5ec', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff', color: '#4B5563', cursor: 'pointer' }}
                  onClick={() => { setPickupModalInitialMode('online'); setShowFsrPickupModal(true); }}
                  title="Online Order"
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                  onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff'; }}
                  onMouseUp={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                >
                  Online
                </button>
              )}
              {fsrTogoButtonVisible && (
                <button
                  className="h-[35px] px-3 flex items-center justify-center text-sm font-bold transition-all duration-150"
                  style={{ borderRadius: '10px', border: 'none', background: '#e0e5ec', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff', color: '#4B5563', cursor: 'pointer' }}
                  onClick={handleNewDeliveryClick}
                  title="Delivery"
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                  onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff'; }}
                  onMouseUp={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                >
                  Delivery
                </button>
              )}
              {fsrTogoButtonVisible && (
                <button
                  className="h-[35px] px-3 flex items-center justify-center text-sm font-bold transition-all duration-150"
                  style={{ borderRadius: '10px', border: 'none', background: '#e0e5ec', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff', color: '#dc2626', cursor: 'pointer' }}
                  onClick={() => { setOrderListOpenMode('pickup'); setOrderListChannelFilter('all'); setOrderListTab('history'); setShowOrderListModal(true); fetchOrderList(orderListDate, 'pickup'); }}
                  title="Pickup List"
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                  onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff'; }}
                  onMouseUp={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                >
                  Pickup List
                </button>
              )}
              <button
                className="h-[35px] px-3 flex items-center justify-center text-sm font-bold transition-all duration-150"
                style={{ borderRadius: '10px', border: 'none', background: '#e0e5ec', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff', color: '#6B7280', cursor: 'pointer' }}
                onClick={() => setShowExitModal(true)}
                title="Exit Menu"
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
                onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff'; }}
                onMouseUp={(e) => { e.currentTarget.style.boxShadow = '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff'; }}
              >
                EXIT
              </button>
            </div>
          </div>

          {/* 2. ì¤‘ì•™ ì˜ì—­ (í”„ë ˆìž„ ë†’ì´ì—ì„œ í—¤ë”/í‘¸í„° ì œì™¸) */}
          <div className="flex-1 flex" style={{ height: `${contentHeightPx}px`, width: `${frameWidthPx}px` }}>
            {/* 3. 좌측 75% - Table Map 영역 */}
            <div 
              className="relative"
              style={{ width: `${leftWidthPx}px`, height: `${contentHeightPx}px` }}
            >
              {/* Move/Merge & Print Bill ëª¨ë“œ ìƒíƒœ í‘œì‹œ */}
              {(isMoveMergeMode || isBillPrintMode) && (moveMergeStatus || billPrintStatus) && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-white font-semibold text-sm"
                  style={{
                    backgroundColor: isBillPrintMode ? 'rgba(16, 185, 129, 0.95)' : 'rgba(139, 92, 246, 0.95)',
                    maxWidth: '90%'
                  }}>
                  {isBillPrintMode ? billPrintStatus : moveMergeStatus}
                </div>
              )}
              {/* í…Œì´ë¸”ë§µ ìº”ë²„ìŠ¤ (BOì™€ ë™ì¼ ê³ ì • í•´ìƒë„ ì ìš©) */}
              <div 
                className="relative bg-white border-2 border-gray-300 shadow-lg"
                style={{
                  width: `${leftWidthPx}px`,
                  height: `${contentHeightPx}px`,
                  marginLeft: 'auto',
                  marginRight: 'auto'
                }}
              >
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">ë°ì´í„° ë¡œë”© ì¤‘...</p>
                    </div>
                  </div>
                ) : (
                  tableElements.map((element) => (
                    <div
                      key={element.id}
                      style={getElementStyle(element)}
                      className={getElementClass(element)}
                      onMouseEnter={(e) => {
                        const isGlass = ['rounded-rectangle','bar','room','circle'].includes(element.type);
                        if (isGlass) {
                          e.currentTarget.style.boxShadow = NEUMORPHIC_SHADOW_HOVER;
                        }
                      }}
                      onMouseLeave={(e) => {
                        const isGlass = ['rounded-rectangle','bar','room','circle'].includes(element.type);
                        if (isGlass) {
                          e.currentTarget.style.boxShadow = NEUMORPHIC_SHADOW_RAISED;
                        }
                        setPressedTableId(prev => (prev === String(element.id) ? null : prev));
                      }}
                      onMouseDown={(e) => {
                        const isGlass = ['rounded-rectangle','bar','room','circle'].includes(element.type);
                        if (isGlass) {
                          e.currentTarget.style.boxShadow = NEUMORPHIC_SHADOW_PRESSED;
                        }
                        setPressedTableId(String(element.id));
                      }}
                      onMouseUp={(e) => {
                        const isGlass = ['rounded-rectangle','bar','room','circle'].includes(element.type);
                        if (isGlass) {
                          e.currentTarget.style.boxShadow = NEUMORPHIC_SHADOW_HOVER;
                        }
                        void handleBistroAwareTableClick(element);
                      }}
                      onTouchStart={() => setPressedTableId(String(element.id))}
                      onTouchEnd={() => void handleBistroAwareTableClick(element)}
                      title={`${element.type} - ${element.status || 'Available'}`}
                    >
                      {element.type === 'restroom' ? (
                        <img src={process.env.PUBLIC_URL + '/images/restroom.png'} alt="Restroom" className="w-full h-full object-contain" draggable={false} />
                      ) : element.type === 'counter' ? (
                        <img src={process.env.PUBLIC_URL + '/images/pos.png'} alt="Counter" className="w-full h-full object-contain" draggable={false} />
                      ) : (
                        (() => {
                          const raw = getElementDisplayName(element) || '';
                          const parts = String(raw).split('\n');
                          const firstLine = parts[0] || '';
                          const secondLine = parts[1] || '';
                          const baseFont = (element as any).fontSize ? Number((element as any).fontSize) : 14;
                          const nameFontSize = Math.round(baseFont * 1.25);
                          const timeFont = Math.max(10, Math.round((baseFont / 2) * 1.6));
                          const isGlassTable =
                            element.type === 'rounded-rectangle' ||
                            element.type === 'bar' ||
                            element.type === 'room' ||
                            element.type === 'circle';
                          const tableServerLabelForEl = tableServerLabelByElementId[String(element.id)];
                          const showTableServerOnMap =
                            isGlassTable && shouldPromptServerSelection && tableServerLabelForEl;
                          const glossRadius = element.type === 'circle' ? '50%' : '26px';
                          const holdData = tableHoldInfo[String(element.id)];
                          const isReservedWithHold = element.status === 'Reserved' && holdData;
                          const showHoldBand = holdData && (element.status === 'Occupied' || element.status === 'Payment Pending' || isReservedWithHold);
                          return (
                            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                              {showHoldBand ? (
                                <div style={{
                                  position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3,
                                  height: isReservedWithHold ? '6px' : '20%',
                                  maxHeight: isReservedWithHold ? 6 : undefined,
                                  background: 'linear-gradient(90deg, #ef4444, #dc2626)',
                                  borderRadius: element.type === 'circle' ? '50% 50% 0 0' : '6px 6px 0 0',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                                  textShadow: '0 1px 2px rgba(0,0,0,0.3)', overflow: 'hidden', whiteSpace: 'nowrap' as const
                                }}>
                                  {!isReservedWithHold && `Hold · ${holdData.customerName} · ${holdData.reservationTime}`}
                                </div>
                              ) : null}
                              {isGlassTable ? (
                                <div
                                  aria-hidden
                                  style={{
                                    position: 'absolute',
                                    inset: 0,
                                    zIndex: 0,
                                    pointerEvents: 'none',
                                    borderRadius: glossRadius,
                                    background:
                                      'linear-gradient(155deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.12) 18%, transparent 42%), linear-gradient(210deg, transparent 55%, rgba(255,255,255,0.08) 78%, rgba(255,255,255,0.18) 100%)',
                                    boxShadow:
                                      'inset 0 4px 10px rgba(255,255,255,0.35), inset 0 -3px 8px rgba(0,0,0,0.06)',
                                  }}
                                />
                              ) : null}
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  textAlign: 'center',
                                  lineHeight: 1.0,
                                  transform: `rotate(${-Number(element.rotation || 0)}deg)`,
                                  transformOrigin: 'center'
                                }}
                              >
                                {showTableServerOnMap ? (
                                  <div
                                    style={{
                                      fontSize: Math.max(7, Math.round(timeFont * 0.62)),
                                      fontWeight: 800,
                                      marginBottom: 2,
                                      maxWidth: '96%',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      color: '#312e81',
                                      opacity: 0.98,
                                    }}
                                    title={`서버: ${tableServerLabelForEl}`}
                                  >
                                    {tableServerLabelForEl}
                                  </div>
                                ) : null}
                                <div style={{ fontSize: nameFontSize, fontWeight: 800 }}>{firstLine}</div>
                                {secondLine ? (
                                  <div style={{ fontSize: timeFont, fontWeight: 700, marginTop: 2, opacity: 0.85 }}>{secondLine}</div>
                                ) : null}
                                {parts[2] ? (
                                  <div style={{ fontSize: Math.max(9, timeFont - 2), fontWeight: 600, marginTop: 1, opacity: 0.75 }}>{parts[2]}</div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  ))
                )}
            </div>
          </div>

          {/* 4. 우측 25% - Togo/Delivery 현황판 · Bistro 는 탭 카드 전용 */}
          {effectiveRightPanelVisible && (
          <div className="bg-blue-50 border-l border-gray-300 relative flex flex-col overflow-hidden" style={{ width: `${rightWidthPx}px`, height: `${contentHeightPx}px`, zIndex: 10 }}>
            {isBistroSalesRoute ? (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <BistroTabPanel
                    orders={bistroPanelOrders}
                    tableStatusById={bistroTableStatusById}
                    loading={bistroOrdersLoading}
                    onRefresh={() => void loadBistroSessionOrders()}
                    onSelectOrder={(orderId, tableId) => {
                      const sess = loadServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID);
                      const sid =
                        sess?.serverId ||
                        (selectedTogoServer?.employee_id != null
                          ? String(selectedTogoServer.employee_id)
                          : '');
                      const sname =
                        (sess?.serverName && String(sess.serverName).trim()) ||
                        (selectedTogoServer?.employee_name && String(selectedTogoServer.employee_name).trim()) ||
                        '';
                      navigate('/sales/order', {
                        state: {
                          orderType: 'POS',
                          menuId: defaultMenu.menuId,
                          menuName: defaultMenu.menuName,
                          tableId,
                          orderId: String(orderId),
                          loadExisting: true,
                          fromBistro: true,
                          floor: selectedFloor,
                          ...(sid && sname ? { serverId: sid, serverName: sname } : {}),
                        },
                      });
                    }}
                  />
                </div>
              </div>
            ) : (
            <>
            {/* 상단 고정 버튼 영역 */}
            <div className="flex gap-2 pt-1 px-2 pb-1.5 flex-shrink-0" style={{ background: '#F0F0F3', borderRadius: '0 0 16px 16px' }}>
              {([
                { label: 'DLV', onClick: handleNewDeliveryClick },
                { label: 'ONLINE', onClick: handleNewOnlineClick },
                { label: 'TOGO', onClick: handleNewTogoClick },
              ] as const).map(({ label, onClick }) => {
                const shadowNormal = [
                  '-8px -8px 20px rgba(255,255,255,0.95)',
                  '8px 8px 20px rgba(163,177,198,0.6)',
                  '2px 4px 8px rgba(163,177,198,0.25)',
                  'inset 0 3px 4px rgba(255,255,255,0.95)',
                  'inset 0 -3px 6px rgba(163,177,198,0.25)',
                ].join(', ');
                const shadowHover = [
                  '-10px -10px 24px rgba(255,255,255,1)',
                  '10px 10px 24px rgba(163,177,198,0.7)',
                  '3px 6px 10px rgba(163,177,198,0.3)',
                  'inset 0 3px 4px rgba(255,255,255,1)',
                  'inset 0 -3px 6px rgba(163,177,198,0.3)',
                ].join(', ');
                const shadowPressed = [
                  'inset 4px 4px 12px rgba(163,177,198,0.3)',
                  'inset -4px -4px 12px rgba(255,255,255,0.7)',
                ].join(', ');
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={onClick}
                    className="relative flex-1 flex items-center justify-center"
                    style={{
                      borderRadius: '40px',
                      border: 'none',
                      minHeight: togoTopBtnMinH,
                      fontSize: `${togoBtnFontPx}px`,
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      cursor: 'pointer',
                      background: 'linear-gradient(145deg, #f7f7f9, #e8e8ec)',
                      boxShadow: shadowNormal,
                      color: '#2C2C2E',
                      textShadow: '0 1px 1px rgba(255,255,255,0.8)',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      userSelect: 'none',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = shadowHover; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = shadowNormal; e.currentTarget.style.transform = 'translateY(0)'; }}
                    onMouseDown={(e) => { e.currentTarget.style.boxShadow = shadowPressed; e.currentTarget.style.transform = 'translateY(1px)'; e.currentTarget.style.color = '#3C3C3E'; }}
                    onMouseUp={(e) => { e.currentTarget.style.boxShadow = shadowHover; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.color = '#2C2C2E'; }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* 스크롤 주문 목록 — Thezone_Backup/TogoPannel: grid-cols-2 좌 Delivery / 우 Togo+Online 통합 */}
            <div className="flex-1 overflow-auto px-1.5 pb-[72px]">
              <div className="grid grid-cols-2 gap-1">
                {/* 왼쪽: Delivery */}
                <div className="min-w-0 space-y-[3px]">
                  {(() => {
                    const deliveryFiltered = [
                      ...togoOrders.filter(order => isRightPanelDeliveryOrder(order)),
                      ...onlineQueueCards.filter(order => isRightPanelDeliveryOrder(order)),
                    ];
                    console.log('ðŸš— [UI] togoOrders total:', togoOrders.length);
                    console.log('ðŸš— [UI] deliveryFiltered:', deliveryFiltered.length, deliveryFiltered);
                    return deliveryFiltered;
                  })()
                    .sort((a, b) => {
                      const now = new Date();
                      const parseReady = (label: string) => {
                        const [h, m] = (label || '99:99').split(':').map(Number);
                        if (!isNaN(h) && !isNaN(m)) {
                          const d = new Date();
                          d.setHours(h, m, 0, 0);
                          return d.getTime();
                        }
                        return Infinity;
                      };
                      const msA = parseReady(String((a as any).readyTimeLabel ?? (a as any).time ?? ''));
                      const msB = parseReady(String((b as any).readyTimeLabel ?? (b as any).time ?? ''));
                      const nowMs = now.getTime();
                      const overdueA = msA < nowMs;
                      const overdueB = msB < nowMs;
                      if (overdueA && !overdueB) return -1;
                      if (!overdueA && overdueB) return 1;
                      if (overdueA && overdueB) return msA - msB; // oldest overdue first
                      return msA - msB; // nearest future first
                    })
                    .map(order => {
                      const isSourceTogo = isMoveMergeMode && sourceTogoOrder?.id === order.id;
                      const isTargetSelectable = isMoveMergeMode && (
                        (sourceTableId && selectionChoice) || 
                        (sourceTogoOrder && sourceTogoOrder.id !== order.id) ||
                        (sourceOnlineOrder)
                      );
                      const dStatus = String(order.status || order.fullOrder?.status || '').toUpperCase();
                      const dIsPanelDelivery = isRightPanelDeliveryOrder(order);
                      const dIsPaid = dStatus === 'PAID' || dStatus === 'COMPLETED' || dStatus === 'CLOSED';
                      const dTreatAsPaid = dIsPanelDelivery || dIsPaid;
                      const dIsPickedUp = dStatus === 'PICKED_UP';
                      const dCanSwipePickup = dTreatAsPaid && !dIsPickedUp;
                      if (dIsPickedUp) return null;
                      let backgroundColor = dIsPickedUp ? '#E9D5FF' : dTreatAsPaid ? 'rgba(229,236,240,0.1)' : 'rgba(219,229,239,0.15)';
                      let borderColor = '#C084FC';
                      let borderWidth = 1;
                      if (isSourceTogo) {
                        backgroundColor = '#A78BFA';
                        borderColor = '#7C3AED';
                        borderWidth = 4;
                      } else if (isTargetSelectable) {
                        backgroundColor = '#D4B8E8';
                        borderColor = '#8B5CF6';
                        borderWidth = 3;
                      }
                      const deliveryMeta = orderListGetDeliveryMeta((order as any).fullOrder || order);
                      const deliveryCardType = (order as any).virtualChannel === 'online' ? 'online' : 'delivery';
                      const deliveryDisplayCompany = orderListNormalizeDeliveryAbbr(deliveryMeta.company) || 'DLV';
                      const deliveryDisplayNumber = formatPosNumber(
                        (order as any).order_number ||
                          (order as any).pos_order_number ||
                          (order as any).posOrderNumber ||
                          (isDailyPosDisplayDigits((order as any).number) ? (order as any).number : null)
                      );
                      const deliveryExternalRaw =
                        (order as any).external_order_number ||
                        (order as any).externalOrderNumber ||
                        (order as any).fullOrder?.external_order_number ||
                        (order as any).fullOrder?.externalOrderNumber ||
                        (order as any).deliveryOrderNumber ||
                        (order as any).fullOrder?.deliveryOrderNumber ||
                        deliveryMeta.orderNumber;
                      const deliveryExternalNumber = formatDeliveryOrderNumberForPanel(deliveryExternalRaw);
                      const deliveryExternalTitle = String(deliveryExternalRaw ?? '').trim() || deliveryExternalNumber;
                      const panelServerRow2 = pickPanelOrderServerLabel(order);
                      return (
                        <div
                          key={`delivery-${order.id}`}
                          className="relative overflow-hidden rounded-lg"
                        >
                          {dCanSwipePickup && swipeDragState?.id === String(order.id) && swipeDragState.offsetX < -20 && (
                            <div className="absolute inset-0 flex items-center justify-end pr-3 bg-emerald-500 rounded-lg z-0">
                              <span className="text-white font-bold text-xs">Pickup ✓</span>
                            </div>
                          )}
                          {dCanSwipePickup && swipeDragState?.id === String(order.id) && swipeDragState.offsetX > 20 && (
                            <div className="absolute inset-0 flex items-center justify-start pl-3 bg-emerald-500 rounded-lg z-0">
                              <span className="text-white font-bold text-xs">Pickup ✓</span>
                            </div>
                          )}
                          <button 
                            className={`w-full rounded-lg px-[3px] py-1.5 text-left transition-all duration-200 relative z-10 ${isTargetSelectable && !isSourceTogo ? 'animate-pulse' : ''}`}
                            style={{
                              background: isSourceTogo ? '#A78BFA' : isTargetSelectable ? '#D4B8E8' : dIsPickedUp ? '#E9D5FF' : '#5c4a3d',
                              border: 'none',
                              minHeight: togoPanelOrderCardMinHeightPx,
                              boxShadow: isSourceTogo || isTargetSelectable
                                ? `inset 2px 2px 5px rgba(0,0,0,0.25), inset -1px -1px 4px rgba(255,255,255,0.08), 0 0 0 ${isSourceTogo ? '3px #7C3AED' : '2px #8B5CF6'}`
                                : '-4px -4px 8px rgba(255,255,255,0.07), 4px 4px 10px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                              transform: swipeDragState?.id === String(order.id) ? `translateX(${swipeDragState.offsetX}px)` : undefined,
                              transition: swipeDragState?.id === String(order.id) ? (swipeDragState.dismissing ? 'transform 0.3s ease-in, opacity 0.3s ease-in' : 'none') : 'transform 0.2s ease',
                              opacity: swipeDragState?.id === String(order.id) && swipeDragState.dismissing ? 0 : undefined,
                              ...(dCanSwipePickup ? { touchAction: 'pan-y' as const } : {}),
                            }}
                            onClick={(e) => {
                              if (swipeDragRef.current || swipeDraggedRef.current) return;
                              e.stopPropagation();
                              handleVirtualOrderCardClick(deliveryCardType as 'delivery' | 'online', order);
                            }}
                            {...(dCanSwipePickup
                              ? {
                                  onTouchStart: (e: React.TouchEvent) => handleSwipeStart(e, String(order.id), deliveryCardType as 'delivery' | 'online'),
                                  onTouchMove: handleSwipeMove,
                                  onTouchEnd: handleSwipeEnd,
                                  onMouseDown: (e: React.MouseEvent) => handleSwipeStart(e, String(order.id), deliveryCardType as 'delivery' | 'online'),
                                  onMouseMove: handleSwipeMove,
                                  onMouseUp: handleSwipeEnd,
                                  onMouseLeave: () => {
                                    if (swipeDragRef.current?.id === String(order.id)) {
                                      swipeDragRef.current = null;
                                      setSwipeDragState(null);
                                    }
                                  },
                                }
                              : {})}
                          >
                            <div className="mb-0.5 flex min-w-0 items-center gap-1 font-semibold" style={{ color: isSourceTogo || isTargetSelectable ? '#1e1e1e' : 'rgba(255,255,255,0.88)' }}>
                              <span className="shrink-0 font-bold" style={{ fontSize: `${togoPanelCardChannelPx}px`, color: isSourceTogo ? '#fff' : isTargetSelectable ? '#581c87' : '#d8b4fe' }}>{deliveryDisplayCompany}</span>
                              <span role="status" className={`inline-flex shrink-0 items-center font-semibold leading-none tracking-tight ${dTreatAsPaid ? 'text-emerald-300' : 'text-red-300'}`} style={{ fontSize: `${togoPanelCardBadgePx}px` }}>{dTreatAsPaid ? 'READY' : 'UNPAID'}</span>
                              <span className="min-w-0 flex-1 overflow-hidden text-right font-bold">
                                <span className="block truncate" style={{ fontSize: `${togoPanelCardLine1PosNumberPx}px` }}>{deliveryDisplayNumber}</span>
                              </span>
                            </div>
                            <div
                              className="flex items-center gap-0.5 font-medium"
                              style={{ fontSize: `${togoPanelCardLine2RowPx}px`, color: isSourceTogo || isTargetSelectable ? '#374151' : 'rgba(255,255,255,0.78)' }}
                            >
                              <span className="inline-flex shrink-0 items-baseline">
                                {renderTogoPanelTimeAmPm(
                                  String((order as any).readyTimeLabel || (order as any).time || ''),
                                  Boolean(isSourceTogo || isTargetSelectable)
                                )}
                              </span>
                              <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
                                {panelServerRow2 ? (
                                  <span
                                    className="max-w-[4rem] shrink-0 truncate rounded px-0.5 py-0 text-center font-semibold leading-none"
                                    style={{
                                      fontSize: `${togoPanelCardServerChipPx}px`,
                                      background: isSourceTogo || isTargetSelectable ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.2)',
                                      color: isSourceTogo || isTargetSelectable ? '#312e81' : '#f1f5f9',
                                      border: isSourceTogo || isTargetSelectable ? '1px solid rgba(99,102,241,0.45)' : '1px solid rgba(255,255,255,0.28)',
                                    }}
                                    title={`서버: ${panelServerRow2}`}
                                  >
                                    {panelServerRow2}
                                  </span>
                                ) : null}
                                <span
                                  className="min-w-0 flex-1 text-right font-bold tabular-nums leading-none truncate"
                                  style={{
                                    fontSize: `${togoPanelCardChannelOrderPx}px`,
                                    color: togoPanelPosLikeTextColor(Boolean(isSourceTogo || isTargetSelectable)),
                                  }}
                                  title={deliveryExternalTitle}
                                >
                                  {deliveryExternalNumber}
                                </span>
                              </div>
                            </div>
                        </button>
                        </div>
                      );
                    })}
                  {[...togoOrders, ...onlineQueueCards].filter(order => isRightPanelDeliveryOrder(order)).length === 0 && (
                    <div className="text-center text-gray-400 text-xs py-4">No Delivery Orders</div>
                  )}
                </div>
                {/* 오른쪽: Togo + Online — Thezone_Backup/TogoPannel 통합 정렬 */}
                <div className="min-w-0 space-y-[3px]">
                  {(() => {
                    /** 카드 시각과 동일한 당일 시계 → 오늘/내일 절대 ms (지난 시각은 다음날로 롤) */
                    const clockHmToDueMsTodayOrTomorrow = (h24: number, minute: number): number => {
                      const d = new Date();
                      d.setSeconds(0, 0);
                      d.setMilliseconds(0);
                      d.setHours(h24, minute, 0, 0);
                      let t = d.getTime();
                      const now = Date.now();
                      if (t < now - 60_000) t += 86400000;
                      return t;
                    };
                    /** formatTimeAmPm 경로와 맞춰 라벨을 픽업 due ms로 (AM/PM·24h·ISO 등) */
                    const parsePickupClockLabelToDueMs = (rawInput: string): number => {
                      const raw = String(rawInput || '').trim();
                      if (!raw) return Infinity;
                      const norm = formatTimeAmPm(raw);
                      if (!norm) return Infinity;
                      const ampmM = norm.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
                      if (ampmM) {
                        let h = parseInt(ampmM[1], 10);
                        const min = parseInt(ampmM[2], 10);
                        if (!Number.isFinite(h) || !Number.isFinite(min)) return Infinity;
                        const isPM = ampmM[3].toUpperCase() === 'PM';
                        if (isPM && h < 12) h += 12;
                        if (!isPM && h === 12) h = 0;
                        return clockHmToDueMsTodayOrTomorrow(
                          Math.max(0, Math.min(23, h)),
                          Math.max(0, Math.min(59, min))
                        );
                      }
                      const m24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
                      if (m24) {
                        const h = parseInt(m24[1], 10);
                        const min = parseInt(m24[2], 10);
                        if (!Number.isFinite(h) || !Number.isFinite(min)) return Infinity;
                        return clockHmToDueMsTodayOrTomorrow(
                          Math.max(0, Math.min(23, h)),
                          Math.max(0, Math.min(59, min))
                        );
                      }
                      const dIso = new Date(raw.replace(' ', 'T'));
                      if (!Number.isNaN(dIso.getTime())) return dIso.getTime();
                      return Infinity;
                    };
                    const togoRowPickupDueMs = (order: any): number => {
                      const label = String(order.readyTimeLabel || order.time || '').trim();
                      if (!label) return Infinity;
                      return parsePickupClockLabelToDueMs(label);
                    };
                    /** ONLINE 카드 좌측 시각(onlineReadyDisplayRaw)과 동일 우선순위로 due ms */
                    const onlineCardPickupDueMs = (card: any): number => {
                      const fo = (card as any).fullOrder || {};
                      const pt = card.pickupTime;
                      if (pt instanceof Date && !Number.isNaN(pt.getTime())) return pt.getTime();
                      if (pt && typeof pt === 'object' && (pt as any)._seconds != null) {
                        const s = Number((pt as any)._seconds);
                        if (Number.isFinite(s)) return s * 1000;
                      }
                      if (pt && typeof pt === 'object' && (pt as any).seconds != null) {
                        const s = Number((pt as any).seconds);
                        if (Number.isFinite(s)) return s * 1000;
                      }
                      if (pt) {
                        const d = new Date(pt as any);
                        if (!Number.isNaN(d.getTime())) return d.getTime();
                      }
                      const rtl =
                        fo.readyTime ||
                        fo.ready_time ||
                        fo.readyTimeLabel ||
                        fo.ready_time_label ||
                        fo.pickupTimeLabel ||
                        fo.pickup_time_label;
                      if (rtl != null && String(rtl).trim() !== '') {
                        return parsePickupClockLabelToDueMs(String(rtl).trim());
                      }
                      const prepStr = prepTimeSettingsRef.current?.thezoneorder?.time || '20m';
                      const prepMin = parseInt(String(prepStr).replace(/[^\d]/g, ''), 10) || 20;
                      const placed = card.placedTime || fo.createdAt;
                      let placedMs: number | null = null;
                      if (placed instanceof Date) placedMs = placed.getTime();
                      else if (placed && typeof placed === 'object') {
                        const sec = (placed as any)._seconds ?? (placed as any).seconds;
                        if (sec != null) placedMs = Number(sec) * 1000;
                      } else if (placed) {
                        const d = new Date(placed as any);
                        if (!Number.isNaN(d.getTime())) placedMs = d.getTime();
                      }
                      if (placedMs != null && !Number.isNaN(placedMs)) return placedMs + prepMin * 60000;
                      return parsePickupClockLabelToDueMs(String(card.time || '').trim());
                    };
                    // 온라인 앱 주문(onlineQueueCards)을 정본으로: 동일 주문의 SQLite 패널 행은 링크 키로 제외해 카드 1장만 표시
                    const onlineCardLinkIndexForTogoDedupe = (() => {
                      const loc = new Set<string>();
                      const fid = new Set<string>();
                      const onum = new Set<string>();
                      const add = (set: Set<string>, v: any) => {
                        const s = String(v ?? '').trim();
                        if (s) set.add(s);
                      };
                      for (const c of onlineQueueCards) {
                        if (isRightPanelDeliveryOrder(c)) continue;
                        const fo = (c as any).fullOrder || {};
                        add(loc, (c as any).localOrderId);
                        add(loc, fo.localOrderId);
                        add(fid, (c as any).id);
                        add(fid, fo.id);
                        add(fid, fo.firebase_order_id);
                        add(fid, fo.firebaseOrderId);
                        add(onum, (c as any).onlineOrderNumber);
                        add(onum, fo.orderNumber);
                        add(onum, fo.order_number);
                        add(onum, fo.externalOrderNumber);
                        add(onum, fo.displayOrderNumber);
                        add(onum, fo.firebaseOrderNumber);
                      }
                      return { loc, fid, onum };
                    })();
                    const togoRowShadowedByOnlineQueueCard = (o: any): boolean => {
                      const oid = String(o.id ?? '').trim();
                      if (oid && onlineCardLinkIndexForTogoDedupe.loc.has(oid)) return true;
                      if (oid && onlineCardLinkIndexForTogoDedupe.fid.has(oid)) return true;
                      const fb = String(o.firebase_order_id ?? o.firebaseOrderId ?? '').trim();
                      if (fb && onlineCardLinkIndexForTogoDedupe.fid.has(fb)) return true;
                      const onu = String(o.onlineOrderNumber ?? o.online_order_number ?? '').trim();
                      if (onu && onlineCardLinkIndexForTogoDedupe.onum.has(onu)) return true;
                      return false;
                    };
                    // SQLite ONLINE 행은 onlineQueueCards(Firestore)와 동일 주문이므로 제외 — 한 장만 표시
                    const combinedOrders: Array<{ order: any; type: 'togo' | 'online'; pickupMs: number }> = [
                      ...togoOrders
                        .filter((o) => !isRightPanelDeliveryOrder(o))
                        // SQLite ONLINE(수동 POS 등)은 Firebase 목록에 없을 수 있음 — 제외하면 카드가 사라짐. 중복은 togoRowShadowedByOnlineQueueCard로만 제거.
                        .filter((o) => !togoRowShadowedByOnlineQueueCard(o))
                        .map((o) => {
                          const panelCh = orderListGetPickupChannel(o);
                          const asOnline = panelCh === 'online';
                          return {
                            order: o,
                            type: asOnline ? ('online' as const) : ('togo' as const),
                            pickupMs: asOnline ? onlineCardPickupDueMs(o) : togoRowPickupDueMs(o),
                          };
                        }),
                      ...onlineQueueCards
                        .filter((o) => !isRightPanelDeliveryOrder(o))
                        .map((o) => ({ order: o, type: 'online' as const, pickupMs: onlineCardPickupDueMs(o) })),
                    ];
                    /** 픽업(표시) 시각 기준: 늦은 순(내림차순). 시각 없음(Infinity)은 맨 아래 */
                    combinedOrders.sort((a, b) => {
                      const ua = !Number.isFinite(a.pickupMs) || a.pickupMs === Infinity;
                      const ub = !Number.isFinite(b.pickupMs) || b.pickupMs === Infinity;
                      if (ua && ub) return String(a.order?.id ?? '').localeCompare(String(b.order?.id ?? ''));
                      if (ua) return 1;
                      if (ub) return -1;
                      const d = b.pickupMs - a.pickupMs;
                      if (d !== 0) return d;
                      return String(a.order?.id ?? '').localeCompare(String(b.order?.id ?? ''));
                    });
                    return combinedOrders.map(({ order, type }) => {
                      if (type === 'togo') {
                        const isSourceTogo = isMoveMergeMode && sourceTogoOrder?.id === order.id;
                        const isTargetSelectable =
                          isMoveMergeMode &&
                          ((sourceTableId && selectionChoice) ||
                            (sourceTogoOrder && sourceTogoOrder.id !== order.id) ||
                            !!sourceOnlineOrder);
                        const tStatus = String(order.status || order.fullOrder?.status || '').toUpperCase();
                        const tIsPaid = tStatus === 'PAID' || tStatus === 'COMPLETED' || tStatus === 'CLOSED';
                        const tIsPickedUp = tStatus === 'PICKED_UP';
                        const tCanSwipePickup = tIsPaid && !tIsPickedUp;
                        if (tIsPickedUp) return null;
                        const panelServerRow2 = pickPanelOrderServerLabel(order);
                        return (
                          <div key={`togo-${order.id}`} className="relative overflow-hidden rounded-lg">
                            {tCanSwipePickup && swipeDragState?.id === String(order.id) && swipeDragState.offsetX < -20 && (
                              <div className="absolute inset-0 z-0 flex items-center justify-end rounded-lg bg-emerald-600 pr-3">
                                <span className="text-xs font-bold text-white">Pickup ✓</span>
                              </div>
                            )}
                            {tCanSwipePickup && swipeDragState?.id === String(order.id) && swipeDragState.offsetX > 20 && (
                              <div className="absolute inset-0 z-0 flex items-center justify-start rounded-lg bg-emerald-600 pl-3">
                                <span className="text-xs font-bold text-white">Pickup ✓</span>
                              </div>
                            )}
                            <button
                              type="button"
                              className={`relative z-10 w-full rounded-lg px-[3px] py-1.5 text-left transition-all duration-200 ${isTargetSelectable && !isSourceTogo ? 'animate-pulse' : ''}`}
                              style={{
                                background: isSourceTogo ? '#A78BFA' : isTargetSelectable ? '#D4B8E8' : '#3d5c48',
                                border: 'none',
                                minHeight: togoPanelOrderCardMinHeightPx,
                                boxShadow:
                                  isSourceTogo || isTargetSelectable
                                    ? `inset 2px 2px 5px rgba(0,0,0,0.25), inset -1px -1px 4px rgba(255,255,255,0.08), 0 0 0 ${isSourceTogo ? '3px #7C3AED' : '2px #8B5CF6'}`
                                    : '-4px -4px 8px rgba(255,255,255,0.07), 4px 4px 10px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                                transform: swipeDragState?.id === String(order.id) ? `translateX(${swipeDragState.offsetX}px)` : undefined,
                                transition:
                                  swipeDragState?.id === String(order.id)
                                    ? swipeDragState.dismissing
                                      ? 'transform 0.3s ease-in, opacity 0.3s ease-in'
                                      : 'none'
                                    : 'transform 0.2s ease',
                                opacity: swipeDragState?.id === String(order.id) && swipeDragState.dismissing ? 0 : undefined,
                                ...(tCanSwipePickup ? { touchAction: 'pan-y' as const } : {}),
                              }}
                              onClick={(e) => {
                                if (swipeDragRef.current || swipeDraggedRef.current) return;
                                e.stopPropagation();
                                void handleVirtualOrderCardClick('togo', order);
                              }}
                              {...(tCanSwipePickup
                                ? {
                                    onTouchStart: (e: React.TouchEvent) => handleSwipeStart(e, String(order.id), 'togo'),
                                    onTouchMove: handleSwipeMove,
                                    onTouchEnd: handleSwipeEnd,
                                    onMouseDown: (e: React.MouseEvent) => handleSwipeStart(e, String(order.id), 'togo'),
                                    onMouseMove: handleSwipeMove,
                                    onMouseUp: handleSwipeEnd,
                                    onMouseLeave: () => {
                                      if (swipeDragRef.current?.id === String(order.id)) {
                                        swipeDragRef.current = null;
                                        setSwipeDragState(null);
                                      }
                                    },
                                  }
                                : {})}
                            >
                              <div
                                className="mb-0.5 flex min-w-0 items-center gap-1 font-semibold"
                                style={{ color: isSourceTogo || isTargetSelectable ? '#1e1e1e' : 'rgba(255,255,255,0.88)' }}
                              >
                                <span className="shrink-0 font-bold" style={{ fontSize: `${togoPanelCardChannelPx}px`, color: isSourceTogo ? '#fff' : isTargetSelectable ? '#065f46' : '#6ee7b7' }}>TOGO</span>
                                <span
                                  role="status"
                                  className={`inline-flex shrink-0 items-center font-semibold leading-none tracking-tight ${tIsPaid ? 'text-emerald-300' : 'text-red-300'}`}
                                  style={{ fontSize: `${togoPanelCardBadgePx}px` }}
                                >
                                  {tIsPaid ? 'READY' : 'UNPAID'}
                                </span>
                                <span className="min-w-0 flex-1 overflow-hidden text-right font-bold">
                                  <span className="block truncate" style={{ fontSize: `${togoPanelCardLine1PosNumberPx}px` }}>{formatPosNumber(order.number)}</span>
                                </span>
                              </div>
                              <div
                                className="flex items-center gap-0.5 font-medium"
                                style={{ fontSize: `${togoPanelCardLine2RowPx}px`, color: isSourceTogo || isTargetSelectable ? '#374151' : 'rgba(255,255,255,0.78)' }}
                              >
                                <span className="inline-flex shrink-0 items-baseline">
                                  {renderTogoPanelTimeAmPm(
                                    String(order.readyTimeLabel || order.time || ''),
                                    Boolean(isSourceTogo || isTargetSelectable)
                                  )}
                                </span>
                                <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
                                  {panelServerRow2 ? (
                                    <span
                                      className="max-w-[4rem] shrink-0 truncate rounded px-0.5 py-0 text-center font-semibold leading-none"
                                      style={{
                                        fontSize: `${togoPanelCardServerChipPx}px`,
                                        background: isSourceTogo || isTargetSelectable ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.2)',
                                        color: isSourceTogo || isTargetSelectable ? '#312e81' : '#f1f5f9',
                                        border: isSourceTogo || isTargetSelectable ? '1px solid rgba(99,102,241,0.45)' : '1px solid rgba(255,255,255,0.28)',
                                      }}
                                      title={`서버: ${panelServerRow2}`}
                                    >
                                      {panelServerRow2}
                                    </span>
                                  ) : null}
                                  <div
                                    className="min-w-0 flex flex-1 justify-end overflow-hidden"
                                    title={formatTogoPanelDisplayId(order.phone, order.name, order.number)}
                                  >
                                    {renderTogoPanelDisplayIdContent(
                                      Boolean(isSourceTogo || isTargetSelectable),
                                      order.phone,
                                      order.name,
                                      order.number
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      }
                      const card = order as OnlineQueueCard;
                      const onlineDailyRaw =
                        (card as any).posOrderNumber ??
                        (card as any).fullOrder?.posOrderNumber ??
                        (card as any).fullOrder?.order_number ??
                        (card as any).order_number ??
                        (typeof (card as any).orderNumber === 'string' &&
                        isDailyPosDisplayDigits((card as any).orderNumber)
                          ? (card as any).orderNumber
                          : null) ??
                        (isDailyPosDisplayDigits((card as any).number) ? (card as any).number : null);
                      const phoneForOnlineSecond =
                        card.phone ||
                        (card as any).fullOrder?.customerPhone ||
                        (card as any).fullOrder?.customer_phone ||
                        (card as any).customerPhone ||
                        '';
                      const onlinePanelDisplayIdTitle = formatOnlineQueueCardSecondLineRight(
                        phoneForOnlineSecond,
                        onlineDailyRaw
                      );
                      const onlinePosDisplayNumber = formatPosNumber(onlineDailyRaw);
                      const isSourceOnline = isMoveMergeMode && sourceOnlineOrder?.id === card.id;
                      const isTargetSelectable =
                        isMoveMergeMode &&
                        ((sourceTableId && selectionChoice) ||
                          (sourceTogoOrder && sourceTogoOrder.id !== card.id) ||
                          !!sourceOnlineOrder);
                      const fo = (card as any).fullOrder || {};
                      const oStatus = String(card.status || fo.status || '').toUpperCase();
                      const oIsPaid = onlineQueueCardIsPaidReady(card);
                      const oIsPickedUp = oStatus === 'PICKED_UP';
                      const onlineCanSwipePickup = oIsPaid && !oIsPickedUp;
                      /** 카드 좌측: 주문 접수 시각이 아니라 픽업/준비 완료 예정 시각(프렙 반영) */
                      const onlineReadyDisplayRaw = (() => {
                        const pt = card.pickupTime;
                        if (pt instanceof Date && !Number.isNaN(pt.getTime())) {
                          return pt.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          });
                        }
                        const rtl =
                          fo.readyTime ||
                          fo.ready_time ||
                          fo.readyTimeLabel ||
                          fo.ready_time_label ||
                          fo.pickupTimeLabel ||
                          fo.pickup_time_label;
                        if (rtl != null && String(rtl).trim() !== '') {
                          return String(rtl).trim();
                        }
                        const prepStr = prepTimeSettingsRef.current?.thezoneorder?.time || '20m';
                        const prepMin = parseInt(String(prepStr).replace(/[^\d]/g, ''), 10) || 20;
                        const placed = card.placedTime || fo.createdAt;
                        let placedMs: number | null = null;
                        if (placed instanceof Date) placedMs = placed.getTime();
                        else if (placed && typeof placed === 'object') {
                          const sec = (placed as any)._seconds ?? (placed as any).seconds;
                          if (sec != null) placedMs = Number(sec) * 1000;
                        } else if (placed) {
                          const d = new Date(placed as any);
                          if (!Number.isNaN(d.getTime())) placedMs = d.getTime();
                        }
                        if (placedMs != null && !Number.isNaN(placedMs)) {
                          return new Date(placedMs + prepMin * 60000).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          });
                        }
                        return String(card.time || '').trim();
                      })();
                      if (oIsPickedUp) return null;
                      const panelServerRow2 = pickPanelOrderServerLabel(card);
                      return (
                        <div key={`online-${card.id}`} className="relative overflow-hidden rounded-lg">
                          {onlineCanSwipePickup && swipeDragState?.id === String(card.id) && swipeDragState.offsetX < -20 && (
                            <div className="absolute inset-0 z-0 flex items-center justify-end pr-3 bg-emerald-500 rounded-lg">
                              <span className="text-white font-bold text-xs">Pickup ✓</span>
                            </div>
                          )}
                          {onlineCanSwipePickup && swipeDragState?.id === String(card.id) && swipeDragState.offsetX > 20 && (
                            <div className="absolute inset-0 z-0 flex items-center justify-start pl-3 bg-emerald-500 rounded-lg">
                              <span className="text-white font-bold text-xs">Pickup ✓</span>
                            </div>
                          )}
                          <button
                            type="button"
                            className={`relative z-10 w-full rounded-lg px-[3px] py-1.5 text-left transition-all duration-200 ${isTargetSelectable && !isSourceOnline ? 'animate-pulse' : ''}`}
                            style={{
                              background: isSourceOnline ? '#A78BFA' : isTargetSelectable ? '#D4B8E8' : '#3d4a6b',
                              border: 'none',
                              minHeight: togoPanelOrderCardMinHeightPx,
                              boxShadow:
                                isSourceOnline || isTargetSelectable
                                  ? `inset 2px 2px 5px rgba(0,0,0,0.25), inset -1px -1px 4px rgba(255,255,255,0.08), 0 0 0 ${isSourceOnline ? '3px #7C3AED' : '2px #8B5CF6'}`
                                  : '-4px -4px 8px rgba(255,255,255,0.07), 4px 4px 10px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.10)',
                              transform: onlineCanSwipePickup && swipeDragState?.id === String(card.id) ? `translateX(${swipeDragState.offsetX}px)` : undefined,
                              transition:
                                onlineCanSwipePickup && swipeDragState?.id === String(card.id)
                                  ? swipeDragState.dismissing
                                    ? 'transform 0.3s ease-in, opacity 0.3s ease-in'
                                    : 'none'
                                  : 'transform 0.2s ease',
                              opacity: onlineCanSwipePickup && swipeDragState?.id === String(card.id) && swipeDragState.dismissing ? 0 : undefined,
                              ...(onlineCanSwipePickup ? { touchAction: 'pan-y' as const } : {}),
                            }}
                            onClick={(e) => {
                              if (swipeDragRef.current || swipeDraggedRef.current) return;
                              e.stopPropagation();
                              void handleVirtualOrderCardClick('online', card);
                            }}
                            {...(onlineCanSwipePickup
                              ? {
                                  onTouchStart: (e: React.TouchEvent) => handleSwipeStart(e, String(card.id), 'online'),
                                  onTouchMove: handleSwipeMove,
                                  onTouchEnd: handleSwipeEnd,
                                  onMouseDown: (e: React.MouseEvent) => handleSwipeStart(e, String(card.id), 'online'),
                                  onMouseMove: handleSwipeMove,
                                  onMouseUp: handleSwipeEnd,
                                  onMouseLeave: () => {
                                    if (swipeDragRef.current?.id === String(card.id)) {
                                      swipeDragRef.current = null;
                                      setSwipeDragState(null);
                                    }
                                  },
                                }
                              : {})}
                          >
                            <div
                              className="mb-0.5 flex min-w-0 items-center gap-1 font-semibold"
                              style={{ color: isSourceOnline || isTargetSelectable ? '#1e1e1e' : 'rgba(255,255,255,0.88)' }}
                            >
                              <span className="shrink-0 font-bold" style={{ fontSize: `${togoPanelCardChannelPx}px`, color: isSourceOnline ? '#fff' : isTargetSelectable ? '#1e3a8a' : '#93c5fd' }}>WEB</span>
                              <span
                                role="status"
                                className={`inline-flex shrink-0 items-center font-semibold leading-none tracking-tight ${oIsPaid ? 'text-emerald-300' : 'text-red-300'}`}
                                style={{ fontSize: `${togoPanelCardBadgePx}px` }}
                              >
                                {oIsPaid ? 'READY' : 'UNPAID'}
                              </span>
                              <span className="min-w-0 flex-1 overflow-hidden text-right font-bold">
                                <span className="block truncate" style={{ fontSize: `${togoPanelCardLine1PosNumberPx}px` }}>{onlinePosDisplayNumber}</span>
                              </span>
                            </div>
                            <div
                              className="flex items-center gap-0.5 font-medium"
                              style={{ fontSize: `${togoPanelCardLine2RowPx}px`, color: isSourceOnline || isTargetSelectable ? '#374151' : 'rgba(255,255,255,0.78)' }}
                            >
                              <span className="inline-flex shrink-0 items-baseline">
                                {renderTogoPanelTimeAmPm(onlineReadyDisplayRaw, Boolean(isSourceOnline || isTargetSelectable))}
                              </span>
                              <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
                                {panelServerRow2 ? (
                                  <span
                                    className="max-w-[4rem] shrink-0 truncate rounded px-0.5 py-0 text-center font-semibold leading-none"
                                    style={{
                                      fontSize: `${togoPanelCardServerChipPx}px`,
                                      background: isSourceOnline || isTargetSelectable ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.2)',
                                      color: isSourceOnline || isTargetSelectable ? '#312e81' : '#f1f5f9',
                                      border: isSourceOnline || isTargetSelectable ? '1px solid rgba(99,102,241,0.45)' : '1px solid rgba(255,255,255,0.28)',
                                    }}
                                    title={`서버: ${panelServerRow2}`}
                                  >
                                    {panelServerRow2}
                                  </span>
                                ) : null}
                                <div
                                  className="min-w-0 flex flex-1 justify-end overflow-hidden"
                                  title={onlinePanelDisplayIdTitle}
                                >
                                  {renderOnlineQueueCardSecondLineRightContent(
                                    Boolean(isSourceOnline || isTargetSelectable),
                                    phoneForOnlineSecond,
                                    onlineDailyRaw
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* í•˜ë‹¨ í”Œë¡œíŒ… ì˜ˆì•½ í˜„í™© - Online+Togo ê·¸ë¦¬ë“œì™€ ë™ì¼í•œ ë„ˆë¹„ — 소프트 네오모픽 입체 패널 */}
            <div
              className="absolute z-[100] flex min-h-0 max-h-[72px] flex-col rounded-[14px] border-0 px-2.5 py-1.5"
              style={{
                left: '3px',
                right: '15px',
                bottom: '3px',
                background: 'linear-gradient(165deg, #fffbeb 0%, #fef3c7 48%, #fde68a 100%)',
                boxShadow:
                  '6px 6px 14px rgba(184, 180, 170, 0.52), -5px -5px 12px rgba(255, 255, 255, 0.94), inset 0 1px 1px rgba(255, 255, 255, 0.88), inset 0 -1px 1px rgba(146, 110, 50, 0.07)',
              }}
            >
              <div className="mb-1 flex flex-shrink-0 items-center justify-between">
                <div className="flex items-center gap-1.5 text-[12px] font-extrabold leading-tight text-amber-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.45)]">
                  Today's Reservations ({todayReservations.length})
                </div>
              </div>
              {todayReservations.length === 0 ? (
                <div className="text-[11px] font-semibold text-amber-600/70 italic text-center py-1">No reservations for today</div>
              ) : (
                <div
                  ref={togoTodayReservationsScrollRef}
                  className={`min-h-0 overflow-x-hidden pr-0 max-h-[52px] sm:max-h-[56px] ${
                    todayReservations.length > 4 ? 'overflow-y-auto' : 'overflow-hidden'
                  } [scrollbar-width:thin] [scrollbar-color:rgba(120,53,15,0.38)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-0 [&::-webkit-scrollbar-thumb]:bg-amber-900/35 [&::-webkit-scrollbar-thumb]:hover:bg-amber-900/50`}
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  <ul className="m-0 list-none p-0 grid grid-cols-2 gap-x-0 gap-y-[2.1px] pb-[1.4px]">
                    {todayReservations.map((res: any, idx: number) => {
                      const isCol1 = idx % 2 === 0;
                      return (
                      <li
                        key={res.id || idx}
                        data-togo-residx={idx}
                        className={`pointer-events-none cursor-default select-none flex min-h-[16px] min-w-0 items-baseline gap-1 py-[1px] text-[11px] leading-tight pl-0.5 ${
                          isCol1
                            ? 'border-r border-amber-300/90 pr-2 mr-1'
                            : 'pl-1.5 pr-0.5'
                        }`}
                      >
                        <span className="w-[2.85rem] shrink-0 font-bold tabular-nums text-amber-900">
                          {res.reservation_time || res.time || '--:--'}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-bold text-gray-800">
                          {res.customer_name || res.name || '—'}
                        </span>
                        <span className="shrink-0 tabular-nums text-[10px] font-bold text-amber-700/90">
                          p{res.party_size || res.guests || 0}
                        </span>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            </>
            )}
          </div>
          )}
          </div>
          <div className="border-t py-1.5 pl-3 pr-3" data-pos-lock="sales-footer" style={{ height: `${footerHeightPx}px`, background: '#d1d5db', borderColor: '#c0c5cc' }}>
            <div className="grid grid-cols-10 h-full w-full" style={{ gap: `${footerGapPx}px` }}>
              {buttonData.map((buttonName, index) => {
                const isMoveMergeActive = buttonName === 'Move\nMerge' && isMoveMergeMode;
                const isBillPrintActive = buttonName === 'Online' && isBillPrintMode;
                const isButtonActive = isMoveMergeActive || isBillPrintActive;
                const normalShadow = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff';
                const hoverShadow = '8px 8px 16px #b8bec7, -8px -8px 16px #ffffff';
                const pressedShadow = 'inset 4px 4px 8px #b8bec7, inset -4px -4px 8px #ffffff';
                return (
                  <div key={buttonName} className="h-full flex items-center justify-center relative group">
                <button
                  onClick={() => handleButtonClick(buttonName)}
                      className="relative w-full h-full flex items-center justify-center text-center leading-tight transition-all duration-150"
                      data-pos-lock="sales-footer-btn"
                      style={{
                        borderRadius: '14px',
                        border: 'none',
                        fontSize: `var(--bottom-bar-btn-font, ${footerButtonFontPx}px)`,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: '#e0e5ec',
                        boxShadow: isButtonActive ? pressedShadow : normalShadow,
                        // Use gray-600 for bottom function button text
                        color: '#4B5563',
                      }}
                  onMouseEnter={(e) => {
                        if (isButtonActive) return;
                        e.currentTarget.style.boxShadow = hoverShadow;
                  }}
                  onMouseLeave={(e) => {
                        if (isButtonActive) return;
                        e.currentTarget.style.boxShadow = normalShadow;
                  }}
                  onMouseDown={(e) => {
                        if (isButtonActive) return;
                        e.currentTarget.style.boxShadow = pressedShadow;
                  }}
                  onMouseUp={(e) => {
                        if (isButtonActive) return;
                        e.currentTarget.style.boxShadow = hoverShadow;
                  }}
                >
                  <span className="whitespace-pre-line">
                    {buttonName}
                  </span>
                      {isMoveMergeActive && (
                        <span
                          className="absolute bottom-1 left-2 right-2 h-[3px] rounded-full opacity-90"
                          style={{
                            animation: 'beamSweep 0.9s linear infinite',
                            background: '#6366f1',
                            boxShadow: '0 0 12px rgba(99,102,241,0.7)',
                            zIndex: 2,
                          }}
                        />
                      )}
                </button>
                {/* Sold Out badge */}
                {buttonName === 'Sold Out' && soldOutItems.size > 0 && (
                  <span className="absolute top-[-6px] right-[-6px] min-w-[20px] h-[20px] bg-red-600 text-white rounded-full flex items-center justify-center shadow-md z-10 text-[10px] font-bold px-1">
                    {soldOutItems.size}
                  </span>
                )}
                {/* Tiny history button for Move/Merge */}
                {buttonName === 'Move\nMerge' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoveHistory(true);
                    }}
                    className="absolute top-[-8px] right-[-8px] w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center shadow-md hover:bg-gray-700 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="View History"
                  >
                    <span className="text-[10px]">H</span>
                  </button>
                )}
            </div>
                );
              })}
          </div>
          </div>
          <TogoOrderModal />
        
        {/* Online Settings Modal (Prep Time, Pause, Day Off, Order Type) */}
        {showPrepTimeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div 
              className="bg-white rounded-xl shadow-2xl w-[644px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header — 네오 볼록 사각 닫기 (빨간 테두리 없음) */}
              <div className="flex shrink-0 items-center justify-between px-5 py-3.5 bg-slate-700 rounded-t-xl">
                <h2 className="text-lg font-bold text-white">Online Settings</h2>
                <button
                  type="button"
                  onClick={() => setShowPrepTimeModal(false)}
                  aria-label="Close"
                  title="Close"
                  className={`flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_CLOSE_X_ON_SLATE700_PRESS_INSET_NO_SHIFT}`}
                  style={{ ...MODAL_CLOSE_X_ON_SLATE700_RAISED_STYLE }}
                >
                  <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Tabs - ìž…ì²´ê° ìžˆëŠ” ë²„íŠ¼ */}
              <div className="flex gap-2.5 p-3" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)' }}>
                <button
                  type="button"
                  onClick={() => setOnlineModalTab('preptime')}
                  className={`flex-1 rounded-2xl border-0 py-4 text-lg font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${onlineModalTab === 'preptime' ? 'text-blue-600' : 'text-gray-600 hover:text-blue-400'}`}
                  style={onlineModalTab === 'preptime'
                    ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 7px #a8b0c4, inset -3px -3px 7px #f0f5ff' }
                    : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Prep Time
                </button>
                <button
                  type="button"
                  onClick={() => setOnlineModalTab('pause')}
                  className={`flex-1 rounded-2xl border-0 py-4 text-lg font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${onlineModalTab === 'pause' ? 'text-orange-600' : 'text-gray-600 hover:text-orange-400'}`}
                  style={onlineModalTab === 'pause'
                    ? { background: 'linear-gradient(145deg, #f0dcd0, #f4e4d8)', boxShadow: 'inset 3px 3px 7px #c9b0a0, inset -3px -3px 7px #fff5f0' }
                    : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => setOnlineModalTab('dayoff')}
                  className={`flex-1 rounded-2xl border-0 py-4 text-lg font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${onlineModalTab === 'dayoff' ? 'text-red-600' : 'text-gray-600 hover:text-red-400'}`}
                  style={onlineModalTab === 'dayoff'
                    ? { background: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', boxShadow: 'inset 3px 3px 7px #c9a0a0, inset -3px -3px 7px #fff0f0' }
                    : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Day Off
                </button>
                <button
                  type="button"
                  onClick={() => setOnlineModalTab('menuhide')}
                  className={`flex-1 rounded-2xl border-0 py-4 text-lg font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${onlineModalTab === 'menuhide' ? 'text-purple-600' : 'text-gray-600 hover:text-purple-400'}`}
                  style={onlineModalTab === 'menuhide'
                    ? { background: 'linear-gradient(145deg, #dcd1f0, #e8ddf8)', boxShadow: 'inset 3px 3px 7px #c4b8d8, inset -3px -3px 7px #f8f2ff' }
                    : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Menu Hide
                </button>
                <button
                  type="button"
                  onClick={() => setOnlineModalTab('utility')}
                  className={`flex-1 rounded-2xl border-0 py-4 text-lg font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${onlineModalTab === 'utility' ? 'text-violet-600' : 'text-gray-600 hover:text-violet-400'}`}
                  style={onlineModalTab === 'utility'
                    ? { background: 'linear-gradient(145deg, #ddd1f0, #e8ddf8)', boxShadow: 'inset 3px 3px 7px #b8a8d8, inset -3px -3px 7px #f5f0ff' }
                    : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Utility
                </button>
              </div>
              
              {/* Tab Content - ê³ ì • ë†’ì´ (15% ì¦ê°€) */}
              <div className="p-4 h-[437px] overflow-auto">
                {/* Prep Time Tab */}
                {onlineModalTab === 'preptime' && (
                <div className="flex flex-col h-full">
                <table className="mx-auto w-[95%] max-w-full border-collapse flex-1">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-[0.475rem] font-medium">Service</th>
                      <th className="text-center py-[0.475rem] font-medium">Mode</th>
                      <th className="text-center py-[0.475rem] font-medium">Prep Time</th>
                      <th className="w-[3.8rem]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* TheZoneOrder */}
                    <tr className="border-b border-gray-200">
                      <td className="py-[0.95rem]">
                        <span className="text-[0.95rem] font-bold text-gray-800">TheZoneOrder</span>
                      </td>
                      <td className="py-[0.95rem]">
                        <div className="flex justify-center">
                          <div className="inline-flex rounded-xl p-[0.2375rem]" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'auto' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.thezoneorder.mode === 'auto' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.thezoneorder.mode === 'auto'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'manual' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.thezoneorder.mode === 'manual' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.thezoneorder.mode === 'manual'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-[0.95rem]">
                        <select
                          value={prepTimeSettings.thezoneorder.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, time: e.target.value } }))}
                          className="mx-auto w-[95%] px-[0.95rem] py-[0.59375rem] border border-gray-300 rounded-lg text-[0.95rem] font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-[0.95rem] pl-[0.7125rem]">
                        <button
                          type="button"
                          onClick={() => setPrepTimeSettings(prev => ({
                            ...prev,
                            ubereats: { ...prev.ubereats, time: prev.thezoneorder.time },
                            doordash: { ...prev.doordash, time: prev.thezoneorder.time },
                            skipthedishes: { ...prev.skipthedishes, time: prev.thezoneorder.time },
                          }))}
                          className={`whitespace-nowrap rounded-xl border-0 px-[0.7125rem] py-[0.59375rem] text-[0.83125rem] font-bold text-blue-600 transition-all duration-200 ${ONLINE_NEO_PRESS}`}
                          style={{ background: 'linear-gradient(145deg, #dde4f0, #e4e8f4)', boxShadow: '4px 4px 8px #b0b8c9, -4px -4px 8px #ffffff' }}
                        >
                          Apply All
                        </button>
                      </td>
                    </tr>

                    {/* UberEats */}
                    <tr className="border-b border-gray-200">
                      <td className="py-[0.95rem]">
                        <span className="text-[0.95rem] font-bold text-gray-800">UberEats</span>
                      </td>
                      <td className="py-[0.95rem]">
                        <div className="flex justify-center">
                          <div className="inline-flex rounded-xl p-[0.2375rem]" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'auto' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.ubereats.mode === 'auto' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.ubereats.mode === 'auto'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'manual' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.ubereats.mode === 'manual' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.ubereats.mode === 'manual'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-[0.95rem]">
                        <select
                          value={prepTimeSettings.ubereats.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, time: e.target.value } }))}
                          className="mx-auto w-[95%] px-[0.95rem] py-[0.59375rem] border border-gray-300 rounded-lg text-[0.95rem] font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>

                    {/* DoorDash */}
                    <tr className="border-b border-gray-200">
                      <td className="py-[0.95rem]">
                        <span className="text-[0.95rem] font-bold text-gray-800">DoorDash</span>
                      </td>
                      <td className="py-[0.95rem]">
                        <div className="flex justify-center">
                          <div className="inline-flex rounded-xl p-[0.2375rem]" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'auto' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.doordash.mode === 'auto' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.doordash.mode === 'auto'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'manual' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.doordash.mode === 'manual' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.doordash.mode === 'manual'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-[0.95rem]">
                        <select
                          value={prepTimeSettings.doordash.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, time: e.target.value } }))}
                          className="mx-auto w-[95%] px-[0.95rem] py-[0.59375rem] border border-gray-300 rounded-lg text-[0.95rem] font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>

                    {/* SkipTheDishes */}
                    <tr>
                      <td className="py-[0.95rem]">
                        <span className="text-[0.95rem] font-bold text-gray-800">SkipTheDishes</span>
                      </td>
                      <td className="py-[0.95rem]">
                        <div className="flex justify-center">
                          <div className="inline-flex rounded-xl p-[0.2375rem]" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'auto' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.skipthedishes.mode === 'auto' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.skipthedishes.mode === 'auto'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'manual' } }))}
                              className={`px-[1.1875rem] py-[0.59375rem] rounded-lg text-[0.83125rem] font-bold transition-all duration-200 border-0 ${ONLINE_NEO_PRESS} ${prepTimeSettings.skipthedishes.mode === 'manual' ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                              style={prepTimeSettings.skipthedishes.mode === 'manual'
                                ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }
                                : { background: 'transparent' }}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-[0.95rem]">
                        <select
                          value={prepTimeSettings.skipthedishes.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, time: e.target.value } }))}
                          className="mx-auto w-[95%] px-[0.95rem] py-[0.59375rem] border border-gray-300 rounded-lg text-[0.95rem] font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
                {/* Save Button */}
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <button
                    onClick={async () => {
                      try {
                        const restaurantId =
                          localStorage.getItem('firebaseRestaurantId') ||
                          localStorage.getItem('firebase_restaurant_id');
                        const response = await fetch(`${API_URL}/online-orders/prep-time-settings`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ settings: prepTimeSettings, restaurantId }),
                        });
                        const data = await response.json();
                        if (data.success) {
                          localStorage.setItem('prepTimeSettings', JSON.stringify(prepTimeSettings));
                          if (data.firebaseSynced) {
                            await loadAllOnlineSettings();
                          }
                          alert(
                            data.firebaseSynced
                              ? 'Prep Time saved and synced with Firebase (same as Dashboard → Online Settings).'
                              : 'Prep Time saved locally. Firebase sync skipped — check Restaurant ID / network.'
                          );
                        } else {
                          alert('Failed to save: ' + (data.error || 'Unknown error'));
                        }
                      } catch (error) {
                        console.error('Prep Time save error:', error);
                        alert('Failed to save settings');
                      }
                    }}
                    type="button"
                    className={`w-full rounded-2xl border-0 py-3 text-lg font-extrabold text-emerald-600 transition-all duration-200 hover:text-emerald-700 ${NEO_COLOR_BTN_PRESS}`}
                    style={{ background: 'linear-gradient(145deg, #d8f0dc, #e4f4e8)', boxShadow: '6px 6px 12px #b0c9b4, -6px -6px 12px #ffffff' }}
                  >
                    Save
                  </button>
                </div>
                </div>
                )}
                
                {/* Pause Tab */}
                {onlineModalTab === 'pause' && (
                  <div className="flex flex-col h-full justify-between">
                    {/* ìƒë‹¨: í˜„ìž¬ ì‹œê°„ & Resume at & Resume All */}
                    <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-xs text-gray-500">Now</div>
                          <div className="text-xl font-bold text-gray-800">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div className="text-2xl text-gray-400">→</div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500">Resume at</div>
                          <div className="text-xl font-bold text-orange-600">
                            {(() => {
                              const pausedChannels = (['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).filter(ch => pauseSettings[ch].pauseUntil);
                              if (pausedChannels.length > 0 && pauseSettings[pausedChannels[0]].pauseUntil) {
                                return pauseSettings[pausedChannels[0]].pauseUntil!.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              }
                              if (selectedPauseDuration) {
                                const durationMap: { [key: string]: number } = { '15m': 15, '30m': 30, '1h': 60, '2h': 120, '3h': 180, '4h': 240, '5h': 300, 'Today': -1 };
                                const min = durationMap[selectedPauseDuration];
                                if (min !== undefined) {
                                  const previewTime = min === -1 ? new Date(new Date().setHours(23, 59, 59, 999)) : new Date(Date.now() + min * 60000);
                                  return previewTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                }
                              }
                              return '--:--';
                            })()}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const restaurantId = localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
                          if (!restaurantId) { alert('Restaurant ID not found'); return; }
                          try {
                            await fetch(`${API_URL}/online-orders/resume/${restaurantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                            setPauseSettings({ thezoneorder: { paused: false, pauseUntil: null }, ubereats: { paused: false, pauseUntil: null }, doordash: { paused: false, pauseUntil: null }, skipthedishes: { paused: false, pauseUntil: null } });
                            setSelectedPauseDuration(null);
                          } catch (error) { console.error('Resume failed:', error); alert('Resume failed'); }
                        }}
                        className={`rounded-2xl border-0 px-5 py-3 text-base font-bold text-emerald-600 transition-all duration-200 hover:text-emerald-700 ${NEO_COLOR_BTN_PRESS}`}
                        style={{ background: 'linear-gradient(145deg, #d8f0dc, #e4f4e8)', boxShadow: '5px 5px 10px #b0c9b4, -5px -5px 10px #ffffff' }}
                      >
                        Resume All
                      </button>
                    </div>
                    
                    {/* ì¤‘ê°„: ì±„ë„ ì„ íƒ */}
                    <div className="p-3 rounded-2xl" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                      <div className="grid grid-cols-5 gap-3">
                        <button
                          onClick={() => {
                            const allSelected = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'].every(ch => pauseSettings[ch as keyof typeof pauseSettings].paused);
                            setPauseSettings(prev => ({
                              thezoneorder: { ...prev.thezoneorder, paused: !allSelected },
                              ubereats: { ...prev.ubereats, paused: !allSelected },
                              doordash: { ...prev.doordash, paused: !allSelected },
                              skipthedishes: { ...prev.skipthedishes, paused: !allSelected },
                            }));
                          }}
                          className={`rounded-xl border-0 py-4 text-base font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${
                            ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'].every(ch => pauseSettings[ch as keyof typeof pauseSettings].paused)
                              ? 'text-gray-700'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                          style={['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'].every(ch => pauseSettings[ch as keyof typeof pauseSettings].paused)
                            ? { background: 'linear-gradient(145deg, #d4d9e0, #dfe4eb)', boxShadow: 'inset 3px 3px 7px #b0b5be, inset -3px -3px 7px #f0f5fc' }
                            : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                        >
                          All
                        </button>
                        {(['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).map((channel) => {
                          const labels = { thezoneorder: 'TZO', ubereats: 'Uber', doordash: 'Door', skipthedishes: 'Skip' };
                          const isSelected = pauseSettings[channel].paused;
                          return (
                            <button
                              key={channel}
                              onClick={() => setPauseSettings(prev => ({ ...prev, [channel]: { ...prev[channel], paused: !prev[channel].paused } }))}
                              className={`rounded-xl border-0 py-4 text-base font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${isSelected ? 'text-orange-600' : 'text-gray-500 hover:text-orange-400'}`}
                              style={isSelected
                                ? { background: 'linear-gradient(145deg, #f0dcd0, #f4e4d8)', boxShadow: 'inset 3px 3px 7px #c9b0a0, inset -3px -3px 7px #fff5f0' }
                                : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                            >
                              {labels[channel]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* í•˜ë‹¨: Pause ì‹œê°„ ì„ íƒ - 4x2 ê·¸ë¦¬ë“œ */}
                    <div className="p-3 rounded-2xl" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: '15m', min: 15 },
                          { label: '30m', min: 30 },
                          { label: '1h', min: 60 },
                          { label: '2h', min: 120 },
                          { label: '3h', min: 180 },
                          { label: '4h', min: 240 },
                          { label: '5h', min: 300 },
                          { label: 'Today', min: -1 },
                        ].map(({ label, min }) => (
                          <button
                            key={label}
                            onClick={() => {
                              setSelectedPauseDuration(label);
                              const pauseUntil = min === -1 
                                ? new Date(new Date().setHours(23, 59, 59, 999)) 
                                : new Date(Date.now() + min * 60000);
                              setPauseSettings(prev => {
                                const updated = { ...prev };
                                (['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).forEach((ch) => {
                                  if (prev[ch].paused) {
                                    updated[ch] = { paused: true, pauseUntil };
                                  }
                                });
                                return updated;
                              });
                            }}
                            className={`rounded-xl border-0 py-4 text-base font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${
                              selectedPauseDuration === label 
                                ? 'text-orange-600' 
                                : 'text-gray-500 hover:text-orange-400'
                            }`}
                            style={selectedPauseDuration === label
                              ? { background: 'linear-gradient(145deg, #f0dcd0, #f4e4d8)', boxShadow: 'inset 3px 3px 7px #c9b0a0, inset -3px -3px 7px #fff5f0' }
                              : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Save Button */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={async () => {
                          try {
                            const response = await fetch(`${API_URL}/online-orders/pause-settings`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ 
                                settings: {
                                  thezoneorder: { paused: pauseSettings.thezoneorder.paused, pausedUntil: pauseSettings.thezoneorder.pauseUntil?.toISOString() || null },
                                  ubereats: { paused: pauseSettings.ubereats.paused, pausedUntil: pauseSettings.ubereats.pauseUntil?.toISOString() || null },
                                  doordash: { paused: pauseSettings.doordash.paused, pausedUntil: pauseSettings.doordash.pauseUntil?.toISOString() || null },
                                  skipthedishes: { paused: pauseSettings.skipthedishes.paused, pausedUntil: pauseSettings.skipthedishes.pauseUntil?.toISOString() || null },
                                }
                              })
                            });
                            const data = await response.json();
                            if (data.success) {
                              alert('Pause settings saved successfully!');
                            } else {
                              alert('Failed to save: ' + (data.error || 'Unknown error'));
                            }
                          } catch (error) {
                            console.error('Pause save error:', error);
                            alert('Failed to save settings');
                          }
                        }}
                        type="button"
                        className={`w-full rounded-2xl border-0 py-3 text-lg font-extrabold text-emerald-600 transition-all duration-200 hover:text-emerald-700 ${NEO_COLOR_BTN_PRESS}`}
                        style={{ background: 'linear-gradient(145deg, #d8f0dc, #e4f4e8)', boxShadow: '6px 6px 12px #b0c9b4, -6px -6px 12px #ffffff' }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Day Off Tab - Firebase ìŠ¤íƒ€ì¼ ë ˆì´ì•„ì›ƒ */}
                {onlineModalTab === 'dayoff' && (
                  <div className="flex flex-col h-full">
                    {/* ìƒë‹¨: 3-column ë ˆì´ì•„ì›ƒ */}
                    <div className="flex gap-3 flex-1">
                      {/* ì™¼ìª½: Channels (16%) */}
                      <div className="flex flex-col rounded-2xl p-3" style={{ width: '16%', background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)', boxShadow: 'inset 2px 2px 4px #c8cdd6, inset -2px -2px 4px #f0f5fc' }}>
                        <div className="text-sm font-bold text-orange-500 mb-2">Channels</div>
                        <div className="space-y-2">
                          {[
                            { id: 'all', name: 'All' },
                            { id: 'thezoneorder', name: 'TZO' },
                            { id: 'ubereats', name: 'Uber' },
                            { id: 'doordash', name: 'Door' },
                            { id: 'skipthedishes', name: 'Skip' },
                          ].map((channel) => {
                            const isAllSelected = dayOffSelectedChannels.includes('all');
                            const isSelected = channel.id === 'all' 
                              ? isAllSelected
                              : isAllSelected || dayOffSelectedChannels.includes(channel.id);
                            return (
                              <button
                                key={channel.id}
                                onClick={() => toggleDayOffChannel(channel.id)}
                                className={`w-full rounded-xl border-0 px-2 py-2 text-center text-sm font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${isSelected ? 'text-orange-600' : 'text-gray-500 hover:text-orange-400'}`}
                                style={isSelected
                                  ? { background: 'linear-gradient(145deg, #f0dcd0, #f4e4d8)', boxShadow: 'inset 3px 3px 6px #c9b0a0, inset -3px -3px 6px #fff5f0' }
                                  : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff' }}
                              >
                                {channel.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* ì¤‘ì•™: ìº˜ë¦°ë” (54%) */}
                      <div className="flex flex-col bg-gray-50 rounded-lg p-3 border border-gray-200" style={{ width: '54%' }}>
                        {/* ìº˜ë¦°ë” í—¤ë” */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={() => setDayOffCalendarMonth(new Date(dayOffCalendarMonth.getFullYear(), dayOffCalendarMonth.getMonth() - 1, 1))}
                            className={`rounded-lg bg-blue-500 p-1.5 text-white transition hover:bg-blue-600 active:brightness-90 ${ONLINE_NEO_PRESS}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <div className="text-base font-bold text-gray-800">
                            {dayOffCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setDayOffCalendarMonth(new Date(dayOffCalendarMonth.getFullYear(), dayOffCalendarMonth.getMonth() + 1, 1))}
                            className={`rounded-lg bg-blue-500 p-1.5 text-white transition hover:bg-blue-600 active:brightness-90 ${ONLINE_NEO_PRESS}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                        
                        {/* ìš”ì¼ í—¤ë” */}
                        <div className="grid grid-cols-7 gap-1 mb-1">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                            <div key={idx} className="text-center text-xs font-semibold text-gray-500 py-1">
                              {day}
                            </div>
                          ))}
                        </div>
                        
                        {/* ìº˜ë¦°ë” ê·¸ë¦¬ë“œ */}
                        <div className="grid grid-cols-7 gap-1 flex-1">
                          {(() => {
                            const year = dayOffCalendarMonth.getFullYear();
                            const month = dayOffCalendarMonth.getMonth();
                            const firstDay = new Date(year, month, 1).getDay();
                            const daysInMonth = new Date(year, month + 1, 0).getDate();
                            const today = getLocalDateString();
                            const cells = [];
                            
                            // ë¹ˆ ì…€ (ì´ì „ ë‹¬)
                            for (let i = 0; i < firstDay; i++) {
                              cells.push(<div key={`empty-${i}`} className="h-8" />);
                            }
                            
                            // ë‚ ì§œ ì…€
                            for (let day = 1; day <= daysInMonth; day++) {
                              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const savedDayOff = dayOffDates.find(d => d.date === dateStr);
                              const isSavedDayOff = !!savedDayOff;
                              const isSelected = dayOffSelectedDates.includes(dateStr);
                              const isToday = dateStr === today;
                              const isPast = dateStr < today;
                              
                              cells.push(
                                <button
                                  type="button"
                                  key={dateStr}
                                  onClick={() => !isPast && toggleDayOffSelection(dateStr)}
                                  disabled={isPast}
                                  className={`
                                    h-8 rounded-lg text-sm font-semibold transition-all
                                    ${isPast ? 'cursor-not-allowed text-gray-300' : `cursor-pointer hover:bg-white ${ONLINE_NEO_PRESS}`}
                                    ${isSavedDayOff ? (savedDayOff?.type === 'closed' ? 'bg-red-500 text-white' : savedDayOff?.type === 'extended' ? 'bg-green-500 text-white' : savedDayOff?.type === 'early' ? 'bg-yellow-500 text-white' : 'bg-purple-500 text-white') : ''}
                                    ${isSelected && !isSavedDayOff ? 'bg-blue-500 text-white' : ''}
                                    ${isToday && !isSavedDayOff && !isSelected ? 'ring-2 ring-blue-400' : ''}
                                  `}
                                >
                                  {day}
                                </button>
                              );
                            }
                            
                            return cells;
                          })()}
                        </div>
                      </div>
                      
                      {/* ì˜¤ë¥¸ìª½: Type + Add Schedule (30%) */}
                      <div className="flex flex-col bg-gray-50 rounded-lg p-3 border border-gray-200" style={{ width: '30%' }}>
                        <div className="text-xs font-bold text-gray-700 mb-1">Type</div>
                        {/* Type ì„ íƒ - 2x2 ê·¸ë¦¬ë“œ (í„°ì¹˜ ì¹œí™”ì ) */}
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          {[
                            { id: 'closed', name: 'Closed', color: 'red' },
                            { id: 'extended', name: 'Ext Open', color: 'green' },
                            { id: 'early', name: 'Early Close', color: 'yellow' },
                            { id: 'late', name: 'Late Open', color: 'purple' },
                          ].map((type) => {
                            const colorMap: Record<string, { selected: { bg: string; shadow: string; text: string }; hover: string }> = {
                              closed: { selected: { bg: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', shadow: 'inset 3px 3px 6px #c9a0a0, inset -3px -3px 6px #fff0f0', text: 'text-red-600' }, hover: 'hover:text-red-400' },
                              extended: { selected: { bg: 'linear-gradient(145deg, #d0ecd8, #dcf0e4)', shadow: 'inset 3px 3px 6px #a0c4a8, inset -3px -3px 6px #f0fff5', text: 'text-emerald-600' }, hover: 'hover:text-emerald-400' },
                              early: { selected: { bg: 'linear-gradient(145deg, #f0e8d0, #f4ecd8)', shadow: 'inset 3px 3px 6px #c9c0a0, inset -3px -3px 6px #fffff0', text: 'text-amber-600' }, hover: 'hover:text-amber-400' },
                              late: { selected: { bg: 'linear-gradient(145deg, #dcd1f0, #e8ddf8)', shadow: 'inset 3px 3px 6px #c4b8d8, inset -3px -3px 6px #f8f2ff', text: 'text-purple-600' }, hover: 'hover:text-purple-400' },
                            };
                            const c = colorMap[type.id];
                            return (
                            <button
                              key={type.id}
                              onClick={() => setDayOffType(type.id as 'closed' | 'extended' | 'early' | 'late')}
                              className={`min-h-[40px] rounded-xl border-0 px-1 py-2.5 text-center text-xs font-bold transition-all duration-200 ${ONLINE_NEO_PRESS} ${dayOffType === type.id ? c.selected.text : `text-gray-500 ${c.hover}`}`}
                              style={dayOffType === type.id
                                ? { background: c.selected.bg, boxShadow: c.selected.shadow }
                                : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff' }}
                            >
                              {type.name}
                            </button>
                            );
                          })}
                        </div>
                        
                        {/* ì‹œê°„ ì„ íƒ (Closedê°€ ì•„ë‹ ë•Œë§Œ í‘œì‹œ) */}
                        {dayOffType !== 'closed' && (
                          <div className="mb-2 p-2 bg-white rounded-lg border border-gray-200">
                            <div className="text-xs text-gray-500 mb-1 font-medium">
                              {dayOffType === 'extended' ? 'Open Until' : dayOffType === 'early' ? 'Close At' : 'Open At'}
                            </div>
                            <select
                              value={dayOffType === 'late' ? dayOffTime.start : dayOffTime.end}
                              onChange={(e) => setDayOffTime(prev => 
                                dayOffType === 'late' 
                                  ? { ...prev, start: e.target.value }
                                  : { ...prev, end: e.target.value }
                              )}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                            >
                              {Array.from({ length: 24 }, (_, i) => {
                                const hour = i.toString().padStart(2, '0');
                                return <option key={hour} value={`${hour}:00`}>{hour}:00</option>;
                              })}
                            </select>
                          </div>
                        )}
                        
                        {/* ì„ íƒ ì •ë³´ í‘œì‹œ */}
                        <div className="text-xs text-gray-500 mb-2 text-center">
                          {dayOffSelectedDates.length} dates, {dayOffSelectedChannels.includes('all') ? 'All' : dayOffSelectedChannels.length} channels
                        </div>
                        
                        {/* Save ë²„íŠ¼ */}
                        <div className="pt-2 border-t border-gray-200">
                          <button
                            onClick={saveDayOffs}
                            disabled={dayOffSaveStatus === 'saving' || dayOffSelectedDates.length === 0}
                            className={`w-full rounded-2xl border-0 py-3 text-lg font-extrabold transition-all duration-200 ${
                              dayOffSaveStatus === 'saving'
                                ? 'cursor-wait text-gray-400'
                                : dayOffSelectedDates.length > 0
                                  ? `text-emerald-600 hover:text-emerald-700 ${NEO_COLOR_BTN_PRESS}`
                                  : `cursor-not-allowed text-gray-400 ${ONLINE_NEO_PRESS}`
                            }`}
                            style={dayOffSaveStatus === 'saving' || dayOffSelectedDates.length === 0
                              ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff' }
                              : { background: 'linear-gradient(145deg, #d8f0dc, #e4f4e8)', boxShadow: '6px 6px 12px #b0c9b4, -6px -6px 12px #ffffff' }}
                          >
                            {dayOffSaveStatus === 'saving' ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                        
                        {/* ì €ìž¥ ì™„ë£Œ ìƒíƒœ í‘œì‹œ */}
                        {dayOffSaveStatus === 'saved' && (
                          <div className="mt-2 text-center text-sm text-green-600 font-medium flex items-center justify-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Saved!
                          </div>
                        )}
                        
                        {/* Clear ë²„íŠ¼ */}
                        {dayOffSelectedDates.length > 0 && (
                          <button
                            onClick={() => {
                              setDayOffSelectedDates([]);
                              setDayOffSaveStatus('idle');
                            }}
                            className="mt-2 w-full py-2 text-sm text-gray-500 hover:text-gray-700 hover:underline"
                          >
                            Clear Selection
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* í•˜ë‹¨: Scheduled ëª©ë¡ */}
                    <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-sm font-bold text-gray-700 mb-2">
                        Scheduled ({dayOffDates.filter(d => d.date >= getLocalDateString()).length})
                      </div>
                      {dayOffDates.filter(d => d.date >= getLocalDateString()).length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-2">No scheduled day offs</div>
                      ) : (
                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                          {dayOffDates
                            .filter(d => d.date >= getLocalDateString())
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((d) => {
                              const typeColor = d.type === 'closed' ? 'bg-red-100 text-red-700 border-red-300' 
                                : d.type === 'extended' ? 'bg-green-100 text-green-700 border-green-300'
                                : d.type === 'early' ? 'bg-yellow-100 text-yellow-700 border-yellow-300'
                                : 'bg-purple-100 text-purple-700 border-purple-300';
                              return (
                                <div
                                  key={`${d.date}-${d.channels}`}
                                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${typeColor}`}
                                >
                                  <span className="font-bold">
                                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                  <span className="text-xs opacity-75">
                                    {d.channels === 'all' ? 'All' : d.channels}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-xs bg-white bg-opacity-50">
                                    {d.type === 'closed' ? 'Closed' : d.type === 'extended' ? 'Ext' : d.type === 'early' ? 'Early' : 'Late'}
                                  </span>
                                  <button 
                                    type="button"
                                    onClick={() => removeDayOff(d.date)} 
                                    className={`ml-1 font-bold hover:opacity-70 ${ONLINE_NEO_PRESS}`}
                                  >
                                    Ã—
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Menu Hide Tab */}
                {onlineModalTab === 'menuhide' && (
                  <div className="flex flex-col h-full">
                    <div className="text-sm text-gray-500 mb-2">
                      Hide menu items or set time limits for Online/Delivery orders.
                    </div>
                    
                    <div className="flex gap-3 flex-1 min-h-0">
                      {/* ì¹´í…Œê³ ë¦¬ ëª©ë¡ (ì¢Œì¸¡ 1/3) */}
                      <div className="w-1/3 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="bg-gray-700 text-white text-sm font-bold px-3 py-2 text-center">
                          Categories
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {menuHideLoading && menuHideCategories.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Loading...
                            </div>
                          ) : menuHideCategories.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No categories
                            </div>
                          ) : (
                            menuHideCategories.map((cat) => (
                              <button
                                key={cat.category_id}
                                onClick={() => {
                                  setMenuHideSelectedCategory(cat.category_id);
                                  setMenuHideSelectedItem(null);
                                }}
                                className={`w-full border-b border-gray-200 px-3 py-2 text-left transition-all ${ONLINE_NEO_PRESS} ${
                                  menuHideSelectedCategory === cat.category_id 
                                    ? 'bg-blue-100 font-bold text-blue-700' 
                                    : 'hover:bg-gray-100'
                                }`}
                              >
                                <div className="text-sm">{cat.name}</div>
                                {(cat.hidden_online_count > 0 || cat.hidden_delivery_count > 0) && (
                                  <div className="flex gap-2 mt-1 text-[10px]">
                                    {cat.hidden_online_count > 0 && (
                                      <span className="text-orange-600 font-semibold">O:{cat.hidden_online_count} hidden</span>
                                    )}
                                    {cat.hidden_delivery_count > 0 && (
                                      <span className="text-red-600 font-semibold">D:{cat.hidden_delivery_count} hidden</span>
                                    )}
                                  </div>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                      
                      {/* ë©”ë‰´ ì•„ì´í…œ ëª©ë¡ (ì¤‘ì•™ 1/3) */}
                      <div className="w-1/3 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="bg-gray-700 text-white text-sm font-bold px-3 py-2 text-center">
                          Menu Items
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {!menuHideSelectedCategory ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Select a category
                            </div>
                          ) : menuHideLoading && menuHideItems.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Loading...
                            </div>
                          ) : menuHideItems.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No items
                            </div>
                          ) : (
                            <>
                              {/* ì•„ì´í…œ ë¦¬ìŠ¤íŠ¸ */}
                              {menuHideItems.map((item) => {
                                const getStatusLabel = (channel: 'online' | 'delivery') => {
                                  const hideType = channel === 'online' ? item.online_hide_type : item.delivery_hide_type;
                                  const availableUntil = channel === 'online' ? item.online_available_until : item.delivery_available_until;
                                  const label = channel === 'online' ? 'O' : 'D';
                                  
                                  if (hideType === 'permanent') {
                                    return <span className={`${channel === 'online' ? 'text-orange-600' : 'text-red-600'} font-semibold`}>{label}:Hidden</span>;
                                  } else if (hideType === 'time_limited' && availableUntil) {
                                    return <span className="text-amber-600 font-semibold">{label}:~{availableUntil}</span>;
                                  }
                                  return <span className="text-emerald-600 font-semibold">{label}:Visible</span>;
                                };
                                
                                return (
                                  <div 
                                    key={item.item_id}
                                    onClick={() => setMenuHideSelectedItem(item.item_id === menuHideSelectedItem ? null : item.item_id)}
                                    className={`px-3 py-2 border-b border-gray-200 cursor-pointer transition-all ${
                                      menuHideSelectedItem === item.item_id 
                                        ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                                        : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <div className="text-sm font-medium leading-tight">{item.name}</div>
                                    <div className="flex gap-2 mt-1 text-[10px]">
                                      {getStatusLabel('online')}
                                      {getStatusLabel('delivery')}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* ì„¤ì • íŒ¨ë„ (ìš°ì¸¡ 1/3) - Modern Design */}
                      <div className="w-1/3 bg-gradient-to-b from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-lg">
                        <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold px-4 py-3 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Visibility Settings
                        </div>
                        <div className="flex-1 flex flex-col overflow-hidden">
                          {!menuHideSelectedItem ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-3 text-slate-400 text-sm text-center gap-3">
                              <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                              </svg>
                              <div>
                                <div className="font-medium text-slate-500">No item selected</div>
                                <div className="text-xs text-slate-400 mt-1">Click a menu item to configure</div>
                              </div>
                            </div>
                          ) : (() => {
                            const selectedItem = menuHideItems.find(i => i.item_id === menuHideSelectedItem);
                            if (!selectedItem) return null;
                            
                            const updateItemHideType = async (
                              channel: 'online' | 'delivery',
                              hideType: 'visible' | 'permanent' | 'time_limited',
                              availableUntil?: string | null,
                              availableFrom?: string | null
                            ) => {
                              try {
                                const updateData: any = {};
                                if (channel === 'online') {
                                  updateData.online_hide_type = hideType;
                                  updateData.online_available_until = hideType === 'time_limited' ? (availableUntil ?? null) : null;
                                  updateData.online_available_from = hideType === 'time_limited' ? (availableFrom ?? null) : null;
                                } else {
                                  updateData.delivery_hide_type = hideType;
                                  updateData.delivery_available_until = hideType === 'time_limited' ? (availableUntil ?? null) : null;
                                  updateData.delivery_available_from = hideType === 'time_limited' ? (availableFrom ?? null) : null;
                                }
                                
                                await fetch(`${API_URL}/menu-visibility/item/${selectedItem.item_id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(updateData)
                                });
                                
                                setMenuHideItems(prev => prev.map(item => {
                                  if (item.item_id === selectedItem.item_id) {
                                    return {
                                      ...item,
                                      ...(channel === 'online' ? {
                                        online_hide_type: hideType,
                                        online_available_until: hideType === 'time_limited' ? (availableUntil ?? null) : null,
                                        online_available_from: hideType === 'time_limited' ? (availableFrom ?? null) : null,
                                        online_visible: hideType === 'permanent' ? 0 : 1
                                      } : {
                                        delivery_hide_type: hideType,
                                        delivery_available_until: hideType === 'time_limited' ? (availableUntil ?? null) : null,
                                        delivery_available_from: hideType === 'time_limited' ? (availableFrom ?? null) : null,
                                        delivery_visible: hideType === 'permanent' ? 0 : 1
                                      })
                                    };
                                  }
                                  return item;
                                }));
                              } catch (error) {
                                console.error('Failed to update hide type:', error);
                              }
                            };
                            
                            // Full-day 30-minute slots so users can build any window (e.g. 11:00–15:00 lunch).
                            const timeOptions = ((): string[] => {
                              const out: string[] = [];
                              for (let h = 0; h < 24; h++) {
                                for (const m of [0, 30]) {
                                  out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                                }
                              }
                              return out;
                            })();
                            
                            // í† ê¸€ ë²„íŠ¼ ì»´í¬ë„ŒíŠ¸: í´ë¦­í•˜ë©´ í™œì„±í™”, ë‹¤ì‹œ í´ë¦­í•˜ë©´ visibleë¡œ
                            const ToggleButton = ({ 
                              active, onClick, icon, label, activeColor, hoverColor 
                            }: { 
                              active: boolean; onClick: () => void; icon: string; label: string; 
                              activeColor: string; hoverColor: string;
                            }) => (
                              <button
                                type="button"
                                onClick={onClick}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-200 ${active ? `${NEO_COLOR_BTN_PRESS}` : `${ONLINE_NEO_PRESS}`} ${
                                  active
                                    ? `${activeColor} scale-[1.02] transform text-white shadow-md`
                                    : `border border-slate-200 bg-white text-slate-600 ${hoverColor} hover:border-slate-300 hover:shadow-sm`
                                }`}
                              >
                                <span className="text-sm">{icon}</span>
                                <span>{label}</span>
                                {active && (
                                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </button>
                            );
                            
                            // í† ê¸€ í•¸ë“¤ëŸ¬: ì´ë¯¸ í™œì„±í™”ëœ ìƒíƒœë©´ visibleë¡œ, ì•„ë‹ˆë©´ í•´ë‹¹ íƒ€ìž…ìœ¼ë¡œ
                            const handleToggle = (channel: 'online' | 'delivery', targetType: 'permanent' | 'time_limited') => {
                              const currentType = channel === 'online' ? selectedItem.online_hide_type : selectedItem.delivery_hide_type;
                              const currentUntil = channel === 'online' ? selectedItem.online_available_until : selectedItem.delivery_available_until;
                              const currentFrom = channel === 'online' ? selectedItem.online_available_from : selectedItem.delivery_available_from;
                              
                              if (currentType === targetType) {
                                // ì´ë¯¸ í™œì„±í™” → visibleë¡œ í† ê¸€
                                updateItemHideType(channel, 'visible');
                              } else {
                                // ë‹¤ë¥¸ ìƒíƒœ → í•´ë‹¹ íƒ€ìž…ìœ¼ë¡œ ë³€ê²½
                                if (targetType === 'time_limited') {
                                  updateItemHideType(channel, 'time_limited', currentUntil || '15:00', currentFrom || null);
                                } else {
                                  updateItemHideType(channel, 'permanent');
                                }
                              }
                            };
                            
                            return (
                              <div className="flex flex-col h-full">
                                {/* Item Name Header - Fixed */}
                                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-3 py-3">
                                  <div className="text-sm font-bold text-slate-900 truncate">{selectedItem.name}</div>
                                </div>
                                
                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                                  {/* Online Settings */}
                                  <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-orange-400 to-orange-600"></div>
                                  <div className="flex items-center justify-between mb-3 pl-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center">
                                        <svg className="w-3.5 h-3.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                        </svg>
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">Online</span>
                                    </div>
                                    {selectedItem.online_hide_type === 'visible' && (
                                      <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Active</span>
                                    )}
                                  </div>
                                  <div className="space-y-2 pl-2">
                                    <ToggleButton
                                      active={selectedItem.online_hide_type === 'permanent'}
                                      onClick={() => handleToggle('online', 'permanent')}
                                      icon={selectedItem.online_hide_type === 'permanent' ? "✕" : "🚫"}
                                      label={selectedItem.online_hide_type === 'permanent' ? "Hidden" : "Permanent Hide"}
                                      activeColor="bg-gradient-to-r from-orange-500 to-orange-600"
                                      hoverColor="hover:bg-orange-50"
                                    />
                                    <div className={`rounded-lg overflow-hidden transition-all duration-200 ${
                                      selectedItem.online_hide_type === 'time_limited'
                                        ? 'ring-2 ring-amber-400 shadow-md'
                                        : 'border border-slate-200'
                                    }`}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggle('online', 'time_limited')}
                                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold transition-all ${selectedItem.online_hide_type === 'time_limited' ? NEO_COLOR_BTN_PRESS : ONLINE_NEO_PRESS} ${
                                          selectedItem.online_hide_type === 'time_limited'
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white'
                                            : 'bg-white text-slate-600 hover:bg-amber-50'
                                        }`}
                                      >
                                        <span className="text-sm">⏰</span>
                                        <span>{selectedItem.online_hide_type === 'time_limited' ? 'Limited' : 'Available Until'}</span>
                                        {selectedItem.online_hide_type === 'time_limited' && (
                                          <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                        )}
                                      </button>
                                      {selectedItem.online_hide_type === 'time_limited' && (
                                        <div className="flex flex-col gap-1 px-3 py-2 bg-amber-50 border-t border-amber-200">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-700 w-10">From</span>
                                            <select
                                              value={selectedItem.online_available_from || ''}
                                              onChange={(e) => updateItemHideType('online', 'time_limited', selectedItem.online_available_until || '15:00', e.target.value || null)}
                                              className="flex-1 px-2 py-1 text-xs bg-white border border-amber-300 rounded font-medium text-amber-800 focus:outline-none"
                                            >
                                              <option value="">— (start of day)</option>
                                              {timeOptions.map(t => (
                                                <option key={`f-${t}`} value={t}>{t}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-700 w-10">Until</span>
                                            <select
                                              value={selectedItem.online_available_until || '15:00'}
                                              onChange={(e) => updateItemHideType('online', 'time_limited', e.target.value, selectedItem.online_available_from || null)}
                                              className="flex-1 px-2 py-1 text-xs bg-white border border-amber-300 rounded font-medium text-amber-800 focus:outline-none"
                                            >
                                              {timeOptions.map(t => (
                                                <option key={`u-${t}`} value={t}>{t}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="text-[10px] text-amber-700/80 italic">
                                            {selectedItem.online_available_from
                                              ? `Visible only between ${selectedItem.online_available_from} – ${selectedItem.online_available_until || '15:00'} (daily)`
                                              : `Visible until ${selectedItem.online_available_until || '15:00'} each day`}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Delivery Settings */}
                                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-rose-400 to-rose-600"></div>
                                  <div className="flex items-center justify-between mb-3 pl-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center">
                                        <svg className="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                                        </svg>
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">Delivery</span>
                                    </div>
                                    {selectedItem.delivery_hide_type === 'visible' && (
                                      <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Active</span>
                                    )}
                                  </div>
                                  <div className="space-y-2 pl-2">
                                    <ToggleButton
                                      active={selectedItem.delivery_hide_type === 'permanent'}
                                      onClick={() => handleToggle('delivery', 'permanent')}
                                      icon={selectedItem.delivery_hide_type === 'permanent' ? "✕" : "🚫"}
                                      label={selectedItem.delivery_hide_type === 'permanent' ? "Hidden" : "Permanent Hide"}
                                      activeColor="bg-gradient-to-r from-rose-500 to-rose-600"
                                      hoverColor="hover:bg-rose-50"
                                    />
                                    <div className={`rounded-lg overflow-hidden transition-all duration-200 ${
                                      selectedItem.delivery_hide_type === 'time_limited'
                                        ? 'ring-2 ring-amber-400 shadow-md'
                                        : 'border border-slate-200'
                                    }`}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggle('delivery', 'time_limited')}
                                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold transition-all ${selectedItem.delivery_hide_type === 'time_limited' ? NEO_COLOR_BTN_PRESS : ONLINE_NEO_PRESS} ${
                                          selectedItem.delivery_hide_type === 'time_limited'
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white'
                                            : 'bg-white text-slate-600 hover:bg-amber-50'
                                        }`}
                                      >
                                        <span className="text-sm">⏰</span>
                                        <span>{selectedItem.delivery_hide_type === 'time_limited' ? 'Limited' : 'Available Until'}</span>
                                        {selectedItem.delivery_hide_type === 'time_limited' && (
                                          <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                        )}
                                      </button>
                                      {selectedItem.delivery_hide_type === 'time_limited' && (
                                        <div className="flex flex-col gap-1 px-3 py-2 bg-amber-50 border-t border-amber-200">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-700 w-10">From</span>
                                            <select
                                              value={selectedItem.delivery_available_from || ''}
                                              onChange={(e) => updateItemHideType('delivery', 'time_limited', selectedItem.delivery_available_until || '15:00', e.target.value || null)}
                                              className="flex-1 px-2 py-1 text-xs bg-white border border-amber-300 rounded font-medium text-amber-800 focus:outline-none"
                                            >
                                              <option value="">— (start of day)</option>
                                              {timeOptions.map(t => (
                                                <option key={`df-${t}`} value={t}>{t}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-700 w-10">Until</span>
                                            <select
                                              value={selectedItem.delivery_available_until || '15:00'}
                                              onChange={(e) => updateItemHideType('delivery', 'time_limited', e.target.value, selectedItem.delivery_available_from || null)}
                                              className="flex-1 px-2 py-1 text-xs bg-white border border-amber-300 rounded font-medium text-amber-800 focus:outline-none"
                                            >
                                              {timeOptions.map(t => (
                                                <option key={`du-${t}`} value={t}>{t}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="text-[10px] text-amber-700/80 italic">
                                            {selectedItem.delivery_available_from
                                              ? `Visible only between ${selectedItem.delivery_available_from} – ${selectedItem.delivery_available_until || '15:00'} (daily)`
                                              : `Visible until ${selectedItem.delivery_available_until || '15:00'} each day`}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    {/* Save Button */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={async () => {
                          if (!menuHideSelectedItem) {
                            alert('Please select a menu item first');
                            return;
                          }
                          const selectedItem = menuHideItems.find(i => i.item_id === menuHideSelectedItem);
                          if (!selectedItem) return;
                          
                          try {
                            const response = await fetch(`${API_URL}/menu-visibility/item/${selectedItem.item_id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                online_hide_type: selectedItem.online_hide_type,
                                online_available_until: selectedItem.online_available_until,
                                online_available_from: selectedItem.online_available_from,
                                delivery_hide_type: selectedItem.delivery_hide_type,
                                delivery_available_until: selectedItem.delivery_available_until,
                                delivery_available_from: selectedItem.delivery_available_from,
                              })
                            });
                            const data = await response.json();
                            if (data.success) {
                              alert('Menu Hide settings saved successfully!');
                              loadMenuHideCategories();
                            } else {
                              alert('Failed to save: ' + (data.error || 'Unknown error'));
                            }
                          } catch (error) {
                            console.error('Menu Hide save error:', error);
                            alert('Failed to save settings');
                          }
                        }}
                        type="button"
                        disabled={!menuHideSelectedItem}
                        className={`w-full rounded-lg py-3 text-lg font-bold shadow-md transition-all ${
                          menuHideSelectedItem
                            ? `bg-emerald-500 text-white hover:bg-emerald-600 ${NEO_COLOR_BTN_PRESS}`
                            : `cursor-not-allowed bg-gray-200 text-gray-400 ${ONLINE_NEO_PRESS}`
                        }`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                {/* Utility Tab - Bag Fee, Utensils (Firebase 연동) — PAY_NEO raised / inset / key */}
                {onlineModalTab === 'utility' && (
                  <div className="flex h-full flex-col gap-3">
                    <p className="mb-1 text-sm text-slate-600">Configure utility options shown to customers at checkout on the online order page.</p>
                    <div className="rounded-[14px] p-4" style={{ ...PAY_NEO.raised }}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-bold text-slate-800">🛍️ Bag Fee</div>
                          <div className="mt-0.5 text-xs text-slate-500">Charge customers a bag fee at checkout.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUtilitySettings(prev => ({ ...prev, bagFee: { ...prev.bagFee, enabled: !prev.bagFee.enabled } }))}
                          className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full border-0 ${ONLINE_NEO_PRESS}`}
                          style={
                            utilitySettings.bagFee.enabled
                              ? {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#7c3aed',
                                  boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.22), 4px 4px 8px #c4c8d4, -3px -3px 8px #ffffff',
                                }
                              : {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#94a3b8',
                                }
                          }
                          aria-pressed={utilitySettings.bagFee.enabled}
                        >
                          <span
                            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200 ${utilitySettings.bagFee.enabled ? 'left-7' : 'left-0.5'}`}
                          />
                        </button>
                      </div>
                      {utilitySettings.bagFee.enabled && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="min-w-[80px] text-sm font-semibold text-slate-700">Fee Amount</label>
                          <div className="inline-flex max-w-[200px] items-stretch overflow-hidden rounded-[12px]" style={{ ...PAY_NEO.inset }}>
                            <span className="border-r border-slate-300/50 bg-[#d4d9e4]/60 px-2.5 py-2 text-sm text-slate-500">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={utilitySettings.bagFee.amount}
                              onChange={(e) => setUtilitySettings(prev => ({ ...prev, bagFee: { ...prev.bagFee, amount: parseFloat(e.target.value) || 0 } }))}
                              className="w-[90px] min-w-0 border-0 bg-transparent px-2.5 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/50"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="rounded-[14px] p-4" style={{ ...PAY_NEO.raised }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-bold text-slate-800">🥢 Utensils</div>
                          <div className="mt-0.5 text-xs text-slate-500">Ask customers how many utensil sets they need</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUtilitySettings(prev => ({ ...prev, utensils: { enabled: !prev.utensils.enabled } }))}
                          className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full border-0 ${ONLINE_NEO_PRESS}`}
                          style={
                            utilitySettings.utensils.enabled
                              ? {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#7c3aed',
                                  boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.22), 4px 4px 8px #c4c8d4, -3px -3px 8px #ffffff',
                                }
                              : {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#94a3b8',
                                }
                          }
                          aria-pressed={utilitySettings.utensils.enabled}
                        >
                          <span
                            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200 ${utilitySettings.utensils.enabled ? 'left-7' : 'left-0.5'}`}
                          />
                        </button>
                      </div>
                    </div>
                    <div className="rounded-[14px] p-4" style={{ ...PAY_NEO.raised }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-bold text-slate-800">🖨️ Pre Order Reprint</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Pre orders or pickups 2+ hours out: kitchen prints &quot;Pre Order Reprint&quot; 30 minutes before pickup.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setUtilitySettings((prev) => ({
                              ...prev,
                              preOrderReprint: { enabled: !prev.preOrderReprint.enabled },
                            }))
                          }
                          className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full border-0 ${ONLINE_NEO_PRESS}`}
                          style={
                            utilitySettings.preOrderReprint.enabled
                              ? {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#7c3aed',
                                  boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.22), 4px 4px 8px #c4c8d4, -3px -3px 8px #ffffff',
                                }
                              : {
                                  ...PAY_NEO.key,
                                  borderRadius: 9999,
                                  background: '#94a3b8',
                                }
                          }
                          aria-pressed={utilitySettings.preOrderReprint.enabled}
                        >
                          <span
                            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200 ${utilitySettings.preOrderReprint.enabled ? 'left-7' : 'left-0.5'}`}
                          />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={saveUtilitySettings}
                      disabled={savingUtility}
                      type="button"
                      className={`w-full rounded-[12px] border-0 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed ${
                        savingUtility ? `cursor-wait text-slate-500 ${ONLINE_NEO_PRESS}` : `text-white ${NEO_COLOR_BTN_PRESS}`
                      }`}
                      style={savingUtility ? { ...PAY_NEO.inset, opacity: 0.85 } : { ...PAY_NEO_UTILITY_SAVE }}
                    >
                      {savingUtility ? 'Saving...' : 'Save Utility Settings'}
                    </button>
                  </div>
                )}
                
              </div>
              
              {/* Footer - Close */}
              <div className="flex justify-end gap-2 px-4 py-3 rounded-b-xl" style={{ background: 'linear-gradient(145deg, #e2e7ee, #dce1e8)' }}>
                <button
                  type="button"
                  onClick={() => setShowPrepTimeModal(false)}
                  className={`rounded-2xl border-0 px-6 py-2.5 text-sm font-bold text-gray-500 transition-all duration-200 hover:text-gray-600 ${ONLINE_NEO_PRESS}`}
                  style={{ background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ìƒˆ ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ ëª¨ë‹¬ (Manual ëª¨ë“œ) */}
        {showNewOrderAlert && newOrderAlertData && (() => {
          const _alertOrder: any = newOrderAlertData;
          const _alertOt = String(_alertOrder.orderType || _alertOrder.order_type || '').toUpperCase();
          const _alertFm = String(_alertOrder.fulfillmentMode || _alertOrder.fulfillment_mode || '').toLowerCase();
          const _alertCompany = String(_alertOrder.deliveryCompany || _alertOrder.delivery_company || '').trim();
          const _alertIsDelivery = _alertOt === 'DELIVERY' || _alertFm === 'delivery' || !!_alertCompany;
          const _alertChannelLabel = _alertIsDelivery
            ? abbreviateDeliveryChannel(_alertCompany || 'Delivery')
            : 'ONLINE';
          const _alertExtRaw = String(
            _alertOrder.externalOrderNumber ||
              _alertOrder.external_order_number ||
              ''
          ).trim();
          const _alertExtTail = formatDeliveryOrderNumberForPanel(_alertExtRaw);
          const _alertHeaderTitle = _alertIsDelivery ? 'New Delivery Order' : 'New Online Order';
          const _alertHeaderGradient = _alertIsDelivery
            ? 'bg-gradient-to-r from-purple-500 to-purple-600'
            : 'bg-gradient-to-r from-orange-500 to-orange-600';
          return (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
            <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden animate-pulse-once">
              {/* Header */}
              <div className={`${_alertHeaderGradient} px-6 py-4`}>
                <h2 className="text-xl font-bold text-white text-center">{_alertHeaderTitle}</h2>
                {_alertIsDelivery && (
                  <div className="mt-1 text-center text-xs font-semibold text-white/90 tracking-wider">
                    {_alertChannelLabel}
                    {_alertExtTail && _alertExtTail !== '—' ? ` · #${_alertExtTail}` : ''}
                  </div>
                )}
              </div>
              
              {/* ì£¼ë¬¸ ì •ë³´ */}
              <div className="p-5 space-y-4">
                {/* ê³ ê° ì •ë³´ */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Customer</span>
                    <span className="font-semibold text-lg">{newOrderAlertData.customerName || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Phone</span>
                    <span className="font-semibold">{newOrderAlertData.customerPhone || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Order Type</span>
                    <span className="font-semibold capitalize">{newOrderAlertData.orderType || 'Online'}</span>
                  </div>
                </div>
                
                {/* ì£¼ë¬¸ í•­ëª© */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-2">Items</div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1">
                    {(newOrderAlertData.items || []).map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{item.quantity || 1}x {item.name}</span>
                        <span className="font-medium">{`$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t mt-3 pt-3 flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span className="text-green-600">{`$${(newOrderAlertData.total || 0).toFixed(2)}`}</span>
                  </div>
                </div>
                
                {/* Prep Time ì„ íƒ */}
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="text-blue-700 font-semibold mb-3 text-center">Select Prep Time</div>
                  <div className="grid grid-cols-6 gap-2">
                    {[10, 15, 20, 30, 45, 60].map((min) => (
                      <button
                        key={min}
                        onClick={() => setSelectedPrepTime(min)}
                        className={`py-3 rounded-lg font-bold text-sm transition-all ${
                          selectedPrepTime === min
                            ? 'bg-blue-600 text-white shadow-lg scale-105'
                            : 'bg-white text-gray-700 border border-gray-200 hover:border-blue-400'
                        }`}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                  <div className="text-center mt-3 text-sm text-gray-600">
                    Pickup Time: <span className="font-bold text-blue-700">
                      {new Date(Date.now() + selectedPrepTime * 60000).toLocaleTimeString('en-US', { 
                        hour: '2-digit', minute: '2-digit', hour12: true 
                      })}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* ë²„íŠ¼ */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={async () => {
                    // Reject: ì£¼ë¬¸ ê±°ì ˆ
                    try {
                      await fetch(`${API_URL}/online-orders/order/${newOrderAlertData.id}/reject`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ restaurantId: onlineOrderRestaurantId }),
                      });
                      console.log('Order rejected:', newOrderAlertData.id);
                    } catch (error) {
                      console.error('Failed to reject order:', error);
                    }
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                    loadOnlineOrders();
                  }}
                  className="flex-1 py-4 bg-gray-400 hover:bg-gray-500 text-white rounded-xl font-bold text-lg transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={async () => {
                    try {
                      claimOnlineAutoAcceptPrintOnce(onlineAutoAcceptPrintOnceRef, newOrderAlertData.id);
                      const pickupTime = getLocalDatetimeString(new Date(Date.now() + selectedPrepTime * 60000));
                      await fetch(`${API_URL}/online-orders/order/${newOrderAlertData.id}/accept`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          prepTime: selectedPrepTime,
                          pickupTime: pickupTime,
                          restaurantId: onlineOrderRestaurantId
                        }),
                      });
                      console.log('Order accepted:', newOrderAlertData.id, 'Prep time:', selectedPrepTime);
                      try {
                        await fetch(`${API_URL}/online-orders/order/${newOrderAlertData.id}/print`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ printerType: 'kitchen', restaurantId: onlineOrderRestaurantId })
                        });
                        console.log('[Manual] Kitchen ticket printed:', newOrderAlertData.id);
                      } catch (printErr) {
                        console.error('[Manual] Kitchen ticket print failed:', printErr);
                      }
                    } catch (error) {
                      console.error('Failed to accept order:', error);
                    }
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                    loadOnlineOrders();
                  }}
                  className="flex-[2] py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-lg transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Card Detail Modal — individual card click */}
        {showCardDetailModal && cardDetailOrder && (() => {
          const cdOrder = cardDetailOrder;
          const cdItems = cardDetailItems;
          const cdChannel = cardDetailChannel;
          const cdStatus = String(cdOrder.status || cdOrder.fullOrder?.status || '').toUpperCase();
          const cdIsPaid =
            cdChannel === 'delivery' ||
            cdStatus === 'PAID' ||
            cdStatus === 'COMPLETED' ||
            cdStatus === 'CLOSED';
          const cdOrderId = cdChannel === 'delivery'
            ? (cdOrder.order_id || cdOrder.id)
            : (cdOrder.localOrderId || cdOrder.fullOrder?.localOrderId || cdOrder.order_id || cdOrder.id);
          const _cdMoney = computeCardDetailModalTotals(cdOrder, cdItems);
          const cdSubtotal = _cdMoney.subtotal;
          const cdTax = _cdMoney.tax;
          const cdTotal = _cdMoney.total;
          const cdName = cdOrder.name || cdOrder.customer_name || cdOrder.fullOrder?.customerName || '';
          const cdPhone = cdOrder.phone || cdOrder.customer_phone || cdOrder.fullOrder?.customerPhone || '';
          /** 딜리버리: 패널·주문목록과 동일 규칙의 채널 주문번호(고객정보 영역 표시용) */
          const cdDeliveryChannelOrderLine =
            cdChannel === 'delivery'
              ? (() => {
                  const { company, orderNumber } = orderListGetDeliveryMeta(cdOrder);
                  let ext = String(orderNumber || '').replace(/^#/, '').trim();
                  if (!ext) ext = String(formatDeliveryPanelDisplayId(cdOrder) || '').trim();
                  if (!ext) return '';
                  const abbr = orderListNormalizeDeliveryAbbr(company);
                  const up = ext.toUpperCase();
                  return abbr ? `${abbr}-${up}` : up;
                })()
              : '';
          const cdNumber = cdOrder.number || cdOrder.order_number || '';
          const cdChannelLabel = cdChannel === 'delivery' ? 'DLV' : cdChannel === 'online' ? 'WEB' : 'TOGO';
          const cdFo = (cdOrder as any).fullOrder || {};
          const cdPickupTimeFromDate = (v: any): string => {
            if (v == null) return '';
            try {
              if (typeof v?.toDate === 'function') {
                const d = v.toDate();
                if (d && !Number.isNaN(d.getTime())) {
                  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                }
              }
              if (typeof v === 'object' && v && '_seconds' in v && (v as any)._seconds != null) {
                const d = new Date((v as any)._seconds * 1000);
                if (!Number.isNaN(d.getTime())) {
                  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                }
              }
              if (typeof v === 'object' && v && 'seconds' in v && (v as any).seconds != null) {
                const d = new Date((v as any).seconds * 1000);
                if (!Number.isNaN(d.getTime())) {
                  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                }
              }
              const d = new Date(v);
              if (!Number.isNaN(d.getTime())) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              }
            } catch {
              /* ignore */
            }
            return '';
          };
          let cdPickupDisplay = '';
          if (cdChannel === 'togo') {
            const raw = String(
              (cdOrder as any).readyTimeLabel || (cdOrder as any).ready_time || (cdOrder as any).time || ''
            ).trim();
            cdPickupDisplay = raw ? formatTimeAmPm(raw) : '';
          } else if (cdChannel === 'delivery') {
            const raw = String(
              (cdOrder as any).readyTimeLabel ||
                (cdOrder as any).ready_time ||
                cdFo.readyTimeLabel ||
                (cdOrder as any).time ||
                ''
            ).trim();
            cdPickupDisplay = raw ? formatTimeAmPm(raw) : '';
          } else {
            const pt = (cdOrder as any).pickupTime ?? cdFo.pickupTime ?? cdFo.readyTime;
            cdPickupDisplay = cdPickupTimeFromDate(pt);
            if (!cdPickupDisplay) {
              const placed = (cdOrder as any).placedTime ?? cdFo.createdAt ?? cdFo.pickup_time;
              cdPickupDisplay = cdPickupTimeFromDate(placed);
            }
            if (!cdPickupDisplay) {
              const raw = String((cdOrder as any).time || cdFo.time || '').trim();
              cdPickupDisplay = raw ? formatTimeAmPm(raw) : '';
            }
          }

          return (
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50"
              onClick={() => setShowCardDetailModal(false)}
              onTouchEnd={(e) => { if (e.target === e.currentTarget) setShowCardDetailModal(false); }}
            >
              <div
                className="relative z-10 flex max-h-[85vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-2xl border-0 p-4"
                style={{
                  ...PAY_NEO.modalShell,
                  background: PAY_NEO_CANVAS,
                  width: Math.min(510, frameWidthPx - 10),
                  maxHeight: contentHeightPx - 40,
                }}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${cdChannel === 'delivery' ? 'bg-red-500' : cdChannel === 'online' ? 'bg-purple-500' : 'bg-green-600'}`}>{cdChannelLabel}</span>
                    <span className="text-lg font-bold text-gray-800">#{cdNumber}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${cdIsPaid ? 'bg-emerald-500' : 'bg-red-500'}`}>{cdIsPaid ? 'READY' : 'UNPAID'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCardDetailModal(false)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center border-0 text-lg font-bold text-gray-700 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                    style={MODAL_CLOSE_X_RAISED_STYLE}
                    title="Close"
                  >
                    ×
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                  {(cdName || cdPhone || cdPickupDisplay || cdDeliveryChannelOrderLine) && (
                    <div className="space-y-2 rounded-[14px] p-2.5 text-base leading-snug" style={PAY_NEO.inset}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-3 text-gray-800">
                          {cdDeliveryChannelOrderLine && (
                            <span className="font-bold text-indigo-900" title="Delivery order #">
                              {cdDeliveryChannelOrderLine}
                            </span>
                          )}
                          {cdName && <span className="font-medium">{cdName}</span>}
                          {cdPhone && <span className="font-bold">{cdPhone}</span>}
                        </div>
                        {cdPickupDisplay ? (
                          <span className="shrink-0 text-base font-bold whitespace-nowrap text-red-600">{cdPickupDisplay}</span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 rounded-[14px] p-2.5" style={CARD_DETAIL_ITEMS_LIST_SLIGHT}>
                    {cdItems.length === 0 ? (
                      <div className="py-8 text-center text-sm text-gray-500">Loading items...</div>
                    ) : (
                      <div className="space-y-1">
                        {cdItems.map((item: any, idx: number) => {
                          const itemPrice = Number(item.price || item.total_price || 0);
                          const qty = item.quantity || 1;
                          const modPrice = Number(item.totalModifierPrice || 0);
                          let mods: any[] = [];
                          try {
                            if (item.modifiers_json) { mods = typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json; }
                            else if (item.options) { mods = item.options; }
                            else if (item.modifiers) { mods = item.modifiers; }
                          } catch {}
                          return (
                            <div key={item.id || item.order_line_id || idx} className="flex items-start justify-between border-b border-gray-200/80 py-[3px] last:border-0">
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-800">
                                  {qty > 1 && <span className="mr-1 font-bold text-blue-600">{qty}x</span>}
                                  {item.name}
                                </div>
                                {Array.isArray(mods) && mods.length > 0 && (
                                  <div className="mt-0.5 pl-3 text-xs text-gray-600">
                                    {mods.map((mod: any, mi: number) => {
                                      const entries = mod.selectedEntries || mod.entries || [];
                                      if (entries.length > 0) {
                                        return entries.map((e: any, ei: number) => (
                                          <div key={`${mi}-${ei}`}>+ {e.name || e.label}{e.price_delta || e.price ? ` ($${Number(e.price_delta || e.price).toFixed(2)})` : ''}</div>
                                        ));
                                      }
                                      return mod.name ? <div key={mi}>+ {mod.name}</div> : null;
                                    })}
                                  </div>
                                )}
                              </div>
                              <span className="ml-3 whitespace-nowrap text-sm font-medium text-gray-700">
                                {formatCurrency((itemPrice + modPrice) * qty)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 rounded-[14px] p-2.5" style={CARD_DETAIL_ITEMS_TAX_FLAT}>
                    <div className="flex justify-between text-sm text-gray-700"><span>Subtotal</span><span>{formatCurrency(cdSubtotal)}</span></div>
                    <div className="mt-1 flex justify-between text-sm text-gray-700"><span>Tax</span><span>{formatCurrency(cdTax)}</span></div>
                    <div className="mt-2 flex justify-between border-t border-gray-300/80 pt-2 text-base font-bold text-gray-800"><span>Total</span><span>{formatCurrency(cdTotal)}</span></div>
                  </div>
                </div>

                <div className="mt-4 flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!cdOrderId) return;
                      const dbId = cdOrder.localOrderId || cdOrder.fullOrder?.localOrderId || cdOrder.order_id || cdOrderId;
                      const orderForList = { ...cdOrder, id: dbId, order_number: cdOrder.order_number || cdOrder.number || cdOrderId };
                      flushSync(() => {
                        setOrderListSelectedOrder(orderForList);
                        setOrderListSelectedItems(cdItems || []);
                      });
                      handleOrderListPrintBill();
                    }}
                    className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-base font-semibold text-white touch-manipulation ${NEO_PRESS_INSET_AMBER_NO_SHIFT}`}
                    style={PAY_NEO_PRIMARY_AMBER}
                  >Print Bill</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!cdOrderId) return;
                      const dbId = cdOrder.localOrderId || cdOrder.fullOrder?.localOrderId || cdOrder.order_id || cdOrderId;
                      const orderForList = { ...cdOrder, id: dbId, order_number: cdOrder.order_number || cdOrder.number || cdOrderId };
                      flushSync(() => {
                        setOrderListSelectedOrder(orderForList);
                        setOrderListSelectedItems(cdItems || []);
                      });
                      handleOrderListPrintKitchen();
                    }}
                    className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-base font-semibold text-gray-900 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                    style={PAY_NEO.key}
                  >Reprint</button>
                  {/* Food Ready 버튼 — UP/딜리버리 채널 주문에만 표시 */}
                  {cdChannel === 'delivery' && (() => {
                    const cdFirebaseId =
                      (cdOrder as any).firebase_id ||
                      (cdOrder as any).firebaseOrderId ||
                      (cdOrder as any).firebase_order_id ||
                      (cdOrder as any).fullOrder?.id ||
                      null;
                    const cdIsAlreadyReady =
                      cdStatus === 'READY' || cdStatus === 'READY_FOR_PICKUP' ||
                      cdStatus === 'COMPLETED' || cdStatus === 'PICKED_UP';
                    if (!cdFirebaseId || cdIsAlreadyReady) return null;
                    return (
                      <button
                        key="food-ready-btn"
                        type="button"
                        onClick={async () => {
                          try {
                            await fetch(
                              `${API_URL}/online-orders/order/${encodeURIComponent(String(cdFirebaseId))}/ready`,
                              { method: 'POST', headers: { 'Content-Type': 'application/json' } }
                            );
                            setShowCardDetailModal(false);
                            loadOnlineOrders();
                          } catch (e) {
                            console.error('[Food Ready] Failed:', e);
                          }
                        }}
                        className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-base font-semibold text-white touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                        style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', boxShadow: '0 2px 8px rgba(22,163,74,0.35)' }}
                      >
                        Food Ready
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const rawType = String(cdOrder.order_type || cdChannel || '').toLowerCase();
                        const rawFulfillment = String(cdOrder.fulfillment_mode || '').toLowerCase();
                        const rawTableId = String(cdOrder.table_id || '').toUpperCase();
                        const voidType =
                          rawType.includes('delivery') || rawFulfillment.includes('delivery') || rawTableId.startsWith('DL')
                            ? 'delivery'
                            : rawType.includes('online') ? 'online'
                            : rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup') ? 'togo'
                            : 'pos';
                        const items = (cdItems || []).map((it: any) => {
                          let mods: any[] = [];
                          try { if (it.modifiers_json) { mods = typeof it.modifiers_json === 'string' ? JSON.parse(it.modifiers_json) : it.modifiers_json; } } catch {}
                          return { ...it, modifiers: mods };
                        });
                        const sels: Record<string, { checked: boolean; qty: number }> = {};
                        items.forEach((it: any) => { const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id); sels[key] = { checked: true, qty: it.quantity || 1 }; });
                        const orderForVoid = {
                          ...cdOrder,
                          id: cdOrderId,
                          number: cdOrder.order_number || cdOrder.number || cdOrderId,
                        };
                        setTogoVoidOrder(orderForVoid); setTogoVoidOrderType(voidType); setTogoVoidItems(items); setTogoVoidSelections(sels);
                        setTogoVoidPin(''); setTogoVoidPinError(''); setTogoVoidReason(''); setTogoVoidReasonPreset(''); setTogoVoidNote(''); setTogoVoidLoading(false);
                        setShowTogoVoidModal(true);
                        setShowCardDetailModal(false);
                      } catch (e) { console.error('[Card Detail Void] Failed:', e); alert('Failed to open void.'); }
                    }}
                    className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-base font-semibold text-red-700 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                    style={PAY_NEO.key}
                  >Void</button>
                  {cdIsPaid ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!cdOrderId) return;
                        try {
                          await fetch(`${API_URL}/orders/${cdOrderId}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'PICKED_UP' }),
                          });
                          const firebaseId = cdOrder.firebase_id;
                          if (firebaseId) {
                            try { await fetch(`${API_URL}/online-orders/order/${firebaseId}/pickup`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch {}
                          }
                          if (cdChannel === 'delivery') {
                            const deliveryMetaId = cdOrder.deliveryMetaId || cdOrder.delivery_meta_id;
                            if (deliveryMetaId) {
                              try { await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(String(deliveryMetaId))}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PICKED_UP' }) }); } catch {}
                            }
                          }
                          setShowCardDetailModal(false);
                          loadTogoOrders();
                          loadOnlineOrders();
                        } catch (e) { console.error('[Card Detail Pickup] Error:', e); }
                      }}
                      className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-base font-semibold text-white touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                      style={PAY_NEO_PRIMARY_BLUE}
                    >Pickup</button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const numId = Number(cdOrderId);
                            const orderId = Number.isFinite(numId) ? numId : cdOrderId;
                            if (!orderId) return;
                            const rawType = String(cdOrder.order_type || cdChannel || '').toLowerCase();
                            const rawFulfillment = String(cdOrder.fulfillment_mode || '').toLowerCase();
                            const nextOrderType =
                              rawType.includes('delivery') || rawFulfillment.includes('delivery')
                                ? 'delivery'
                                : rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                ? 'togo'
                                : rawType.includes('online')
                                ? 'online'
                                : 'pos';
                            navigate('/sales/order', {
                              state: {
                                orderType: nextOrderType,
                                menuId: defaultMenu.menuId,
                                menuName: defaultMenu.menuName,
                                orderId,
                                customerName: cdName,
                                customerPhone: cdPhone,
                                readyTimeLabel: cdOrder.ready_time || cdOrder.readyTimeLabel || '',
                                fulfillmentMode: cdOrder.fulfillment_mode || null,
                                openPayment: true,
                                fromOrderHistory: true,
                                deliveryMetaId: (cdOrder as any).deliveryMetaId || (cdOrder as any).delivery_meta_id || null,
                              },
                            });
                            setShowCardDetailModal(false);
                          } catch (e) { console.error('[Card Detail Pay] Failed:', e); }
                        }}
                        className={`min-w-0 flex-1 border-0 px-2 py-3 text-base font-semibold text-white touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                        style={{ ...PAY_NEO_PRIMARY_BLUE, ...PCM_RX_ROUND }}
                      >Pay</button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const numId = Number(cdOrderId);
                            const orderId = Number.isFinite(numId) ? numId : cdOrderId;
                            if (!orderId) return;
                            const rawType = String(cdOrder.order_type || cdChannel || '').toLowerCase();
                            const rawFulfillment = String(cdOrder.fulfillment_mode || '').toLowerCase();
                            const nextOrderType =
                              rawType.includes('delivery') || rawFulfillment.includes('delivery')
                                ? 'delivery'
                                : rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                ? 'togo'
                                : rawType.includes('online')
                                ? 'online'
                                : 'pos';
                            navigate('/sales/order', {
                              state: {
                                orderType: nextOrderType,
                                menuId: defaultMenu.menuId,
                                menuName: defaultMenu.menuName,
                                orderId,
                                customerName: cdName,
                                customerPhone: cdPhone,
                                readyTimeLabel: cdOrder.ready_time || cdOrder.readyTimeLabel || '',
                                fulfillmentMode: cdOrder.fulfillment_mode || null,
                                openPayment: true,
                                autoPickup: true,
                                fromOrderHistory: true,
                                deliveryMetaId: (cdOrder as any).deliveryMetaId || (cdOrder as any).delivery_meta_id || null,
                                firebaseOrderId:
                                  (cdOrder as any).firebase_order_id ||
                                  (cdOrder as any).firebaseOrderId ||
                                  (cdOrder as any).fullOrder?.firebase_order_id ||
                                  (cdOrder as any).fullOrder?.firebaseOrderId ||
                                  null,
                              },
                            });
                            setShowCardDetailModal(false);
                          } catch (e) { console.error('[Card Detail Pay&Pickup] Failed:', e); }
                        }}
                        className={`min-w-0 flex-[1.35] border-0 px-4 py-3 text-lg font-bold text-white touch-manipulation ml-[30px] ${NEO_COLOR_BTN_PRESS}`}
                        style={{ ...PAY_NEO_PRIMARY_BLUE, ...PCM_RX_ROUND }}
                      >Pay &amp; Pickup</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Order List Modal - Inline rendering to prevent scroll reset on state change */}
        {showOrderListModal && (() => {
          const totals = orderListSelectedOrder ? orderListCalculateTotals() : null;
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div 
                className="bg-gray-200 rounded-xl shadow-2xl w-full max-w-[1000px] h-full max-h-[740px] min-h-[400px] flex flex-col relative"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-slate-700 rounded-t-xl flex-shrink-0 relative">
                  {/* Gift Card 모달과 동일 패턴 — 네모(rounded-xl) + PAY_NEO.raised + 눌림 */}
                  <button
                    type="button"
                    onClick={() => { setShowOrderListModal(false); setShowOrderListCalendar(false); setOrderListSelectedOrder(null); setOrderListSelectedItems([]); setLiveOrderHighlightItem(null); }}
                    className={`absolute right-3 top-1/2 z-[99999] flex h-12 w-12 -translate-y-1/2 shrink-0 touch-manipulation items-center justify-center rounded-xl border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_CLOSE_X_ON_SLATE700_PRESS_INSET_NO_SHIFT}`}
                    style={{ ...MODAL_CLOSE_X_ON_SLATE700_RAISED_STYLE }}
                    aria-label="Close"
                    title="Close"
                  >
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  {/* íƒ­ ë²„íŠ¼: Order History / Live Order */}
                  {orderListOpenMode === 'pickup' ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setOrderListChannelFilter('all')}
                        className="px-4 py-2 rounded-xl text-sm font-bold text-slate-800 transition-transform active:scale-[0.98] touch-manipulation"
                        style={orderListChannelFilter === 'all' ? SOFT_NEO.panel : SOFT_NEO.tabRaised}
                      >
                        All
                      </button>
                      {(['delivery'] as const).map((ch) => (
                        <PickupChannelGlassButton
                          key={ch}
                          channel={ch}
                          active={orderListChannelFilter === ch}
                          onClick={() => setOrderListChannelFilter(ch)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setOrderListTab('history'); setLiveOrderHighlightItem(null); }}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-transform active:scale-[0.98] touch-manipulation ${
                          orderListTab === 'history' ? 'text-white' : 'text-slate-800'
                        }`}
                        style={orderListTab === 'history' ? OH_ACTION_NEO.slate : SOFT_NEO.tabRaised}
                      >
                        Order History
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderListTab('live')}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-transform active:scale-[0.98] touch-manipulation ${
                          orderListTab === 'live' ? 'text-white' : 'text-slate-800'
                        }`}
                        style={orderListTab === 'live' ? OH_ACTION_NEO.green : SOFT_NEO.tabRaised}
                      >
                        🟢 Live Order
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 sm:gap-3 relative" style={{ marginRight: "55px" }}>
                    {/* ë‚ ì§œ ì„ íƒì€ Order History íƒ­ì—ì„œë§Œ í‘œì‹œ */}
                    {orderListOpenMode === 'history' && orderListTab === 'history' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOrderListDateChange(-1)}
                          className="px-3 py-2 text-sm font-bold text-gray-800 transition-transform active:scale-95 touch-manipulation sm:px-5 sm:py-3 sm:text-base rounded-xl"
                          style={SOFT_NEO.tabRaised}
                        >
                          ◀
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOrderListCalendarMonth(new Date(orderListDate));
                            setShowOrderListCalendar(!showOrderListCalendar);
                          }}
                          className="min-w-[150px] rounded-xl px-3 py-2 text-center text-sm font-bold text-gray-800 transition-transform active:scale-[0.99] touch-manipulation sm:min-w-[200px] sm:px-5 sm:py-3 sm:text-base"
                          style={SOFT_NEO.panel}
                        >
                          📅 {orderListFormatDate(orderListDate)}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOrderListDateChange(1)}
                          className="px-3 py-2 text-sm font-bold text-gray-800 transition-transform active:scale-95 touch-manipulation sm:px-5 sm:py-3 sm:text-base rounded-xl"
                          style={SOFT_NEO.tabRaised}
                        >
                          ▶
                        </button>
                      </>
                    )}

                    {/* Calendar Dropdown */}
                    {showOrderListCalendar && (
                      <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl border border-gray-300 p-3 z-50" style={{ width: '300px' }}>
                        <div className="flex items-center justify-between mb-3">
                          <button
                            type="button"
                            onClick={() => setOrderListCalendarMonth(new Date(orderListCalendarMonth.getFullYear(), orderListCalendarMonth.getMonth() - 1))}
                            className="rounded-xl p-2 text-lg font-bold text-gray-800 transition-transform active:scale-95 touch-manipulation"
                            style={SOFT_NEO.tabRaised}
                          >
                            ◀
                          </button>
                          <span className="font-bold text-lg text-gray-800">
                            {orderListCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOrderListCalendarMonth(new Date(orderListCalendarMonth.getFullYear(), orderListCalendarMonth.getMonth() + 1))}
                            className="rounded-xl p-2 text-lg font-bold text-gray-800 transition-transform active:scale-95 touch-manipulation"
                            style={SOFT_NEO.tabRaised}
                          >
                            ▶
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                            <div key={d} className="font-bold text-gray-500 py-1">{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {orderListGetDaysInMonth(orderListCalendarMonth).map((day, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => day && orderListHandleCalendarDateSelect(day)}
                              disabled={!day}
                              className={`p-2 rounded-xl text-sm font-medium transition-transform active:scale-95 touch-manipulation ${
                                !day ? '' :
                                getLocalDateString(day) === orderListDate 
                                  ? 'text-white' 
                                  : 'text-gray-800'
                              }`}
                              style={
                                !day
                                  ? undefined
                                  : getLocalDateString(day) === orderListDate
                                    ? OH_ACTION_NEO.blue
                                    : SOFT_NEO.tabRaised
                              }
                            >
                              {day?.getDate() || ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content - Order History Tab (also used in pickup mode) */}
                {(orderListTab === 'history' || orderListOpenMode === 'pickup') && (
                <div className="flex flex-col md:flex-row p-2 sm:p-3 gap-2 sm:gap-3 flex-1 min-h-0" style={{ overflow: 'hidden' }}>
                  {/* Left Panel - Order List (55%) */}
                  <div className="w-full md:w-[55%] h-1/2 md:h-full bg-white rounded-xl shadow-lg border-2 border-gray-300 flex flex-col" style={{ overflow: 'hidden' }}>
                    <div
                      className={`bg-slate-700 px-2 font-bold text-white flex items-center flex-shrink-0 ${
                        orderListOpenMode === 'pickup' ? 'py-[0.6rem] text-sm' : 'py-2.5 text-base'
                      }`}
                    >
                      {orderListOpenMode === 'pickup' ? (
                        <>
                          <span className="w-[76px] text-center flex-shrink-0">Channel</span>
                          <span className="w-[48px] text-center flex-shrink-0">#</span>
                          <span className="flex-1 min-w-0 ml-1 pl-0.5">Order ID</span>
                          <span className="w-[80px] text-center flex-shrink-0">Ready Time</span>
                          <span className="w-[68px] text-center flex-shrink-0">Status</span>
                          <span className="w-[76px] text-right flex-shrink-0 pr-0.5">Amount</span>
                        </>
                      ) : (
                        <>
                          <span className="w-[60px] text-center flex-shrink-0">Channel</span>
                          <span className="w-[87px] text-center flex-shrink-0">#</span>
                          <span className="flex-1 min-w-0 ml-1">Order ID</span>
                          <span className="w-[70px] text-center flex-shrink-0">Ready Time</span>
                          <span className="w-[52px] text-center flex-shrink-0">Status</span>
                          <span className="w-[60px] text-right flex-shrink-0">Amount</span>
                        </>
                      )}
                    </div>
                    <div 
                      className="flex-1 bg-slate-50 relative" 
                      style={{ 
                        overflowY: 'auto', 
                        overflowX: 'hidden',
                        overscrollBehavior: 'contain', 
                        WebkitOverflowScrolling: 'touch',
                        minHeight: 0,
                        maxHeight: '100%'
                      }}
                    >
                      {orderListLoading ? (
                        <div className="flex items-center justify-center h-32 text-gray-500 text-base">Loading...</div>
                      ) : orderListOrders.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-gray-500 text-base">No orders found</div>
                      ) : (
                        orderListOrders.filter((order) => {
                          if (orderListOpenMode !== 'pickup') return true;
                          const _f = String(order.fulfillment_mode || '').toLowerCase();
                          const _s = String(order.status || '').toUpperCase();
                          const _t = orderListNormalizeChannelToken(order.order_type);
                          const isDineIn = _t === 'DINEIN' || _t === 'POS';
                          if (isDineIn) return false;
                          if (_s === 'PICKED_UP') return false;
                          if (_s === 'VOIDED' || _s === 'VOID' || _s === 'REFUNDED') return false;
                          const pickupChannel = orderListGetPickupChannel({
                            ...order,
                            fulfillment: _f,
                          });
                          const normalizedPickupChannel = pickupChannel === 'other' ? 'togo' : pickupChannel;
                          if (orderListChannelFilter === 'delivery') return normalizedPickupChannel === 'delivery';
                          return true;
                        }).sort((a, b) => {
                          const now = Date.now();
                          const parseReadyTime = (o: any): number | null => {
                            if (orderListOpenMode === 'pickup') {
                              const createdRaw = o?.created_at || o?.createdAt;
                              const pm = Number(o?.pickup_minutes ?? o?.pickupMinutes ?? o?.prep_time ?? o?.prepTime ?? 0);
                              if (createdRaw && Number.isFinite(pm) && pm > 0) {
                                const d = new Date(createdRaw);
                                if (!Number.isNaN(d.getTime())) return d.getTime() + pm * 60000;
                              }
                            }
                            const rt =
                              o.ready_time ||
                              o.readyTime ||
                              o.readyTimeLabel ||
                              o.ready_time_label ||
                              o.pickup_time ||
                              o.pickupTime ||
                              o.time ||
                              '';
                            const rtTrim = String(rt).trim();
                            if (!rtTrim) return null;
                            if (rtTrim.length >= 10 && (rtTrim.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(rtTrim))) {
                              const isoMs = new Date(rtTrim.replace(' ', 'T')).getTime();
                              if (!Number.isNaN(isoMs)) return isoMs;
                            }
                            const today = new Date();
                            const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                            const parsed = new Date(`${dateStr}T${rtTrim}`);
                            if (!isNaN(parsed.getTime())) return parsed.getTime();
                            const m = rtTrim.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
                            if (m) {
                              let h = parseInt(m[1], 10);
                              const min = parseInt(m[2], 10);
                              const isPm = m[3].toUpperCase() === 'PM';
                              if (isPm && h < 12) h += 12;
                              if (!isPm && h === 12) h = 0;
                              const base = new Date(`${dateStr}T00:00:00`);
                              base.setHours(h, min, 0, 0);
                              return base.getTime();
                            }
                            return null;
                          };
                          const aTime = parseReadyTime(a);
                          const bTime = parseReadyTime(b);
                          if (aTime === null && bTime === null) return 0;
                          if (aTime === null) return -1;
                          if (bTime === null) return 1;
                          const aIsPast = aTime <= now;
                          const bIsPast = bTime <= now;
                          if (aIsPast && !bIsPast) return -1;
                          if (!aIsPast && bIsPast) return 1;
                          return aTime - bTime;
                        }).map((order, _rowIdx) => {
                          const badge = orderListGetChannelBadge(order);
                          const type = (order.order_type || '').toUpperCase();
                          const fulfillment = String(order.fulfillment_mode || '').toLowerCase();
                          const isDelivery = type === 'DELIVERY' || fulfillment === 'delivery';
                          const isOnline = type === 'ONLINE' || type === 'WEB' || type === 'QR';
                          const isTogo = type === 'TOGO' || type === 'TAKEOUT' || type === 'PICKUP';
                          const { company: deliveryCompanyRaw, orderNumber: deliveryOrderNumberRaw } = orderListGetDeliveryMeta(order);
                          const deliveryCompanyAbbr = orderListNormalizeDeliveryAbbr(deliveryCompanyRaw);
                          const deliveryOrderNumber = String(deliveryOrderNumberRaw || '').replace(/^#/, '').trim();
                          const posSeqNum = order.order_number ? `#${order.order_number}` : `#${String(order.id).padStart(3, '0')}`;
                          const phoneDigits = String(order.customer_phone || order.customerPhone || '').replace(/\D/g, '');
                          const custName = String(order.customer_name || order.customerName || '').trim();
                          let channelOrderId = '';
                          if (isDelivery) {
                            const extClean = String(deliveryOrderNumber || '').toUpperCase();
                            channelOrderId = extClean ? `${deliveryCompanyAbbr || 'DLV'}-${extClean}` : (deliveryCompanyAbbr || 'DLV');
                          } else if (isOnline) {
                            const onlineNum = String(order.online_order_number || order.onlineOrderNumber || '').trim().replace(/"/g, '');
                            let suffix = '';
                            if (onlineNum) { suffix = onlineNum.toUpperCase(); }
                            else if (phoneDigits.length >= 4) { suffix = phoneDigits.slice(-4); }
                            else if (phoneDigits.length > 0) { suffix = phoneDigits; }
                            else { const seq = String(order.order_number || ''); if (seq) suffix = seq; }
                            channelOrderId = suffix ? `ONLINE-${suffix}` : 'ONLINE';
                          } else if (isTogo) {
                            let suffix = '';
                            if (phoneDigits.length >= 4) { suffix = phoneDigits.slice(-4); }
                            else if (phoneDigits.length > 0) { suffix = phoneDigits; }
                            else if (custName) { suffix = custName.slice(0, 8).toUpperCase(); }
                            else { const seq = String(order.order_number || ''); if (seq) suffix = seq; }
                            channelOrderId = suffix ? `TOGO-${suffix}` : 'TOGO';
                          } else {
                            channelOrderId = custName || '-';
                          }
                          const readyTimeDisplay = orderListPickupTimeDisplay(order);
                          const subtotalVal = Number(order.subtotal || 0);
                          const taxVal = Number(order.tax || 0);
                          const totalVal = Number(order.total || 0);
                          const hasSubtotalOrTax = Number.isFinite(subtotalVal) && Number.isFinite(taxVal) && (Math.abs(subtotalVal) > 0 || Math.abs(taxVal) > 0);
                          const displayAmount = hasSubtotalOrTax ? Number((subtotalVal + taxVal).toFixed(2)) : totalVal;
                          const sameSelected = orderListSelectedOrder?.id === order.id;
                          const fromList = String(order.status || '').toUpperCase();
                          const fromDetail =
                            sameSelected && orderListSelectedOrder
                              ? String(orderListSelectedOrder.status || '').toUpperCase()
                              : '';
                          const olStatus = fromDetail || fromList;
                          const olIsPaid = olStatus === 'PAID' || olStatus === 'COMPLETED' || olStatus === 'CLOSED';
                          const olIsPickedUp = olStatus === 'PICKED_UP';
                          const olIsSelected = sameSelected;
                          const olEvenBg = _rowIdx % 2 === 0 ? '#F8FAFC' : '#F1F5F9';
                          const olBg = olIsSelected ? '#BFDBFE' : olIsPickedUp ? '#FFFFFF' : olEvenBg;
                          const pickupMode = orderListOpenMode === 'pickup';
                          const pickupPosDigits = pickupMode ? orderListPickupListPosDigits(order) : '';
                          const pickupOrderIdText = pickupMode ? orderListPickupListOrderId(order) : '';
                          const olIsLabelTarget = !olIsPickedUp && (isOnline || isDelivery || isTogo);
                          let olLabel: string | null = null;
                          if (pickupMode) {
                            if (!olIsPickedUp) olLabel = olIsPaid ? 'Ready' : 'Unpaid';
                          } else if (olIsLabelTarget) {
                            if (isDelivery) { olLabel = 'Ready'; }
                            else if (isOnline) { olLabel = olIsPaid ? 'Ready' : 'Unpaid'; }
                            else { olLabel = olIsPaid ? 'Ready' : 'Unpaid'; }
                          }
                          return (
                            <React.Fragment key={order.id}>
                            <div
                              onClick={(e) => { e.stopPropagation(); fetchOrderDetails(order.id); }}
                              className={`flex items-center gap-1.5 px-2 cursor-pointer hover:brightness-95 ${
                                pickupMode ? 'py-3.5 text-lg' : 'py-3 text-base'
                              }`}
                              style={{ backgroundColor: olBg }}
                            >
                              {pickupMode ? (
                                <>
                                  <span className="w-[76px] flex shrink-0 justify-center px-0.5">
                                    <span
                                      className={`inline-flex min-h-[28px] min-w-[64px] max-w-[76px] items-center justify-center rounded-[5px] px-2 py-1 text-center text-[11px] font-bold uppercase leading-tight tracking-wide text-white shadow-sm ${badge.bgColor} ${badge.textColor}`}
                                    >
                                      {badge.label}
                                    </span>
                                  </span>
                                  <span className="w-[48px] text-center font-mono text-base font-bold tabular-nums text-slate-800 flex-shrink-0">
                                    {pickupPosDigits}
                                  </span>
                                  <span className="flex-1 min-w-0 truncate text-base font-semibold text-slate-900 ml-1" title={pickupOrderIdText}>
                                    {pickupOrderIdText}
                                  </span>
                                  <span className="w-[80px] text-center font-semibold text-slate-800 flex-shrink-0 text-base tabular-nums">
                                    {readyTimeDisplay || '—'}
                                  </span>
                                  <span className="w-[68px] text-center flex-shrink-0">
                                    {olLabel && (
                                      <span className={`text-sm font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap ${olLabel === 'Unpaid' ? 'text-red-700 bg-red-50 border border-red-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200'}`}>{olLabel}</span>
                                    )}
                                  </span>
                                  <span className="w-[76px] text-right font-bold text-slate-900 flex-shrink-0 text-base tabular-nums pr-0.5">{`$${Number(displayAmount || 0).toFixed(2)}`}</span>
                                </>
                              ) : (
                                <>
                                  <span className={`w-[60px] px-1 py-1 rounded text-center text-sm font-bold flex-shrink-0 ${badge.bgColor} ${badge.textColor}`}>
                                    {badge.label}
                                  </span>
                                  <span className="w-[87px] text-center font-bold text-gray-700 flex-shrink-0">{posSeqNum}</span>
                                  <span className="flex-1 min-w-0 truncate font-bold ml-1" title={channelOrderId}>{channelOrderId}</span>
                                  <span className="w-[70px] text-center font-bold flex-shrink-0 text-sm">{readyTimeDisplay || '—'}</span>
                                  <span className="w-[52px] text-center flex-shrink-0">
                                    {olLabel && (
                                      <span className={`text-xs font-bold px-1 py-0.5 rounded whitespace-nowrap ${olLabel === 'Unpaid' ? 'text-red-600 bg-red-100' : 'text-emerald-700 bg-emerald-100'}`}>{olLabel}</span>
                                    )}
                                  </span>
                                  <span className="w-[60px] text-right font-bold flex-shrink-0">{`$${Number(displayAmount || 0).toFixed(2)}`}</span>
                                </>
                              )}
                            </div>
                            <div style={{ height: '1px', backgroundColor: 'rgba(190,209,236,0.2)' }} />
                            </React.Fragment>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Panel - Order Details (45%) */}
                  <div className="w-full md:w-[45%] h-1/2 md:h-full bg-blue-50 rounded-xl shadow-lg border-2 border-blue-200 flex flex-col" style={{ overflow: 'hidden' }}>
                    {!orderListSelectedOrder ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400 text-base">
                        Select an order to view details
                      </div>
                    ) : (
                      <>
                        {/* Action Buttons - ë§¨ ìœ„ë¡œ ì´ë™ */}
                        <div className="flex flex-shrink-0 gap-1.5 px-4 py-3" style={OH_ACTION_NEO.bar}>
                          {orderListOpenMode === 'pickup' ? (() => {
                            const _fl = getOrderListPickupActionFlex(orderListSelectedOrder);
                            return (
                            <>
                              <button
                                type="button"
                                onClick={handleOrderListPrintBill}
                                style={{ flex: _fl.bar, ...OH_ACTION_NEO.blue }}
                                className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                              >
                                Print Bill
                              </button>
                              <button
                                type="button"
                                onClick={handleOrderListPrintKitchen}
                                style={{ flex: _fl.bar, ...OH_ACTION_NEO.orange }}
                                className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                              >
                                Reprint
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const rawType = String(orderListSelectedOrder.order_type || '').toLowerCase();
                                    const rawFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                    const rawTableId = String(orderListSelectedOrder.table_id || '').toUpperCase();
                                    const voidType =
                                      rawType.includes('delivery') || rawFulfillment.includes('delivery') || rawTableId.startsWith('DL')
                                        ? 'delivery'
                                        : rawType.includes('online') ? 'online'
                                        : rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup') ? 'togo'
                                        : 'pos';
                                    const items = (orderListSelectedItems || []).map((it: any) => {
                                      let mods: any[] = [];
                                      try { if (it.modifiers_json) { mods = typeof it.modifiers_json === 'string' ? JSON.parse(it.modifiers_json) : it.modifiers_json; } } catch {}
                                      return { ...it, modifiers: mods };
                                    });
                                    const sels: Record<string, { checked: boolean; qty: number }> = {};
                                    items.forEach((it: any) => { const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id); sels[key] = { checked: true, qty: it.quantity || 1 }; });
                                    const sqliteVoidId = resolveSqliteOrderIdForVoid(orderListSelectedOrder, voidType);
                                    const orderForVoid = {
                                      ...orderListSelectedOrder,
                                      id: sqliteVoidId ?? orderListSelectedOrder.id,
                                      number: orderListSelectedOrder.order_number || orderListSelectedOrder.number || sqliteVoidId || orderListSelectedOrder.id,
                                    };
                                    setTogoVoidOrder(orderForVoid); setTogoVoidOrderType(voidType); setTogoVoidItems(items); setTogoVoidSelections(sels);
                                    setTogoVoidPin(''); setTogoVoidPinError(''); setTogoVoidReason(''); setTogoVoidReasonPreset(''); setTogoVoidNote(''); setTogoVoidLoading(false);
                                    setShowTogoVoidModal(true);
                                  } catch (e) { console.error('[Pickup Void] Failed:', e); alert('Failed to open void.'); }
                                }}
                                style={{ flex: _fl.bar, ...OH_ACTION_NEO.red }}
                                className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                              >
                                Void
                              </button>
                              {(() => {
                                const _pkType = (orderListSelectedOrder.order_type || '').toUpperCase();
                                const _pkTableId = (orderListSelectedOrder.table_id || '').toString().toUpperCase();
                                const _pkFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                const _pkStatus = String(orderListSelectedOrder.status || '').toUpperCase();
                                const _pkIsDelivery = _pkType === 'DELIVERY' || _pkFulfillment === 'delivery' || _pkType === 'UBEREATS' || _pkType === 'UBER' || _pkType === 'DOORDASH' || _pkType === 'SKIP' || _pkType === 'SKIPTHEDISHES' || _pkType === 'FANTUAN' || _pkTableId.startsWith('DL');
                                const _pkIsPaid = _pkStatus === 'PAID' || _pkStatus === 'COMPLETED' || _pkStatus === 'CLOSED' || _pkIsDelivery;

                                if (_pkIsPaid) {
                                  return (
                                    <button
                                      onClick={async () => {
                                        const orderId = orderListSelectedOrder?.id;
                                        if (!orderId) return;
                                        try {
                                          const _firebaseId = orderListSelectedOrder.firebase_id;
                                          const isTogoLike =
                                            _pkType === 'TOGO' ||
                                            _pkType === 'TAKEOUT' ||
                                            _pkFulfillment === 'togo' ||
                                            _pkTableId.startsWith('TG');
                                          const isOnlineOrder =
                                            !_pkIsDelivery &&
                                            !isTogoLike &&
                                            (_pkType === 'ONLINE' ||
                                              _pkType === 'WEB' ||
                                              _pkType === 'QR' ||
                                              _pkTableId.startsWith('OL') ||
                                              _pkFulfillment === 'online');

                                          await fetch(`${API_URL}/orders/${orderId}/status`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ status: 'PICKED_UP' }),
                                          });

                                          if (isOnlineOrder && _firebaseId) {
                                            try {
                                              await fetch(`${API_URL}/online-orders/order/${_firebaseId}/pickup`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                              });
                                            } catch (e) { console.error('[Pickup] Firebase pickup failed:', e); }
                                          }

                                          if (_pkIsDelivery && _pkTableId.startsWith('DL')) {
                                            const deliveryMetaId = _pkTableId.substring(2);
                                            if (deliveryMetaId) {
                                              try {
                                                await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(deliveryMetaId)}/status`, {
                                                  method: 'PATCH',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ status: 'PICKED_UP' }),
                                                });
                                              } catch (e) { console.error('[Pickup] Delivery meta pickup failed:', e); }
                                            }
                                          }

                                          setOrderListSelectedOrder(null);
                                          setOrderListSelectedItems([]);
                                          fetchOrderList(orderListDate, orderListOpenMode);
                                          loadTogoOrders();
                                          loadOnlineOrders();
                                        } catch (e) { console.error('[Pickup Complete] Error:', e); }
                                      }}
                                      type="button"
                                      style={{ flex: _fl.single, ...OH_ACTION_NEO.green }}
                                      className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                                    >
                                      Pickup
                                    </button>
                                  );
                                }

                                const openPickupPay = async (autoPickup: boolean) => {
                                  try {
                                    const orderId = Number(orderListSelectedOrder.id);
                                    if (!Number.isFinite(orderId)) return;
                                    const rawType = String(orderListSelectedOrder.order_type || '').toLowerCase();
                                    const rawFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                    const nextOrderType =
                                      rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                        ? 'togo'
                                        : rawType.includes('online')
                                          ? 'online'
                                          : 'pos';
                                    const fb =
                                      (orderListSelectedOrder as any).firebase_order_id ||
                                      (orderListSelectedOrder as any).firebaseOrderId ||
                                      (orderListSelectedOrder as any).firebase_id ||
                                      null;
                                    const dm =
                                      (orderListSelectedOrder as any).delivery_meta_id ||
                                      (orderListSelectedOrder as any).deliveryMetaId ||
                                      null;
                                    navigate('/sales/order', {
                                      state: {
                                        orderType: nextOrderType,
                                        menuId: defaultMenu.menuId,
                                        menuName: defaultMenu.menuName,
                                        orderId,
                                        customerName: orderListSelectedOrder.customer_name || '',
                                        customerPhone: orderListSelectedOrder.customer_phone || '',
                                        readyTimeLabel: orderListSelectedOrder.ready_time || '',
                                        fulfillmentMode: orderListSelectedOrder.fulfillment_mode || null,
                                        openPayment: true,
                                        fromOrderHistory: true,
                                        ...(autoPickup ? { autoPickup: true, firebaseOrderId: fb, deliveryMetaId: dm } : {}),
                                      },
                                    });
                                    setShowOrderListModal(false);
                                  } catch (e) {
                                    console.error('[Pickup Pay] Failed to open payment:', e);
                                    alert('Failed to open payment.');
                                  }
                                };

                                if (_pkIsDelivery) {
                                  return (
                                    <button
                                      onClick={() => { void openPickupPay(false); }}
                                      type="button"
                                      style={{ flex: _fl.single, ...OH_ACTION_NEO.green }}
                                      className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                                    >
                                      Pay
                                    </button>
                                  );
                                }

                                return (
                                  <div className="flex min-w-0 gap-1" style={{ flex: _fl.payPair }}>
                                    <button
                                      onClick={() => { void openPickupPay(false); }}
                                      type="button"
                                      style={{ flex: _fl.pay, ...OH_ACTION_NEO.green }}
                                      className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                                    >
                                      Pay
                                    </button>
                                    <button
                                      onClick={() => { void openPickupPay(true); }}
                                      type="button"
                                      style={{ flex: _fl.payPickup, ...OH_ACTION_NEO.blue }}
                                      className={`min-w-0 rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                                    >
                                      Pay & Pickup
                                    </button>
                                  </div>
                                );
                              })()}
                            </>
                            );
                          })() : (
                          <>
                          {/* 1. Back to Order */}
                          {(() => {
                            const _type = (orderListSelectedOrder.order_type || '').toUpperCase();
                            const _tableId = (orderListSelectedOrder.table_id || '').toString().toUpperCase();
                            const _fulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                            const isOnlineOrDelivery =
                              _type === 'UBEREATS' || _type === 'UBER' || _type === 'DOORDASH' || _type === 'SKIP' || _type === 'SKIPTHEDISHES' ||
                              _type === 'ONLINE' || _type === 'WEB' || _type === 'QR' || _tableId.startsWith('OL') ||
                              _type === 'DELIVERY' || _fulfillment === 'delivery' || _tableId.startsWith('DL');
                            return (
                              <button
                                type="button"
                                disabled={isOnlineOrDelivery}
                                onClick={() => {
                                  if (isOnlineOrDelivery) return;
                                  const orderId = orderListSelectedOrder.id;
                                  const rawType = String(orderListSelectedOrder.order_type || '').toLowerCase();
                                  const rawFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                  const nextOrderType =
                                    rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                      ? 'togo'
                                      : 'pos';

                                  navigate('/sales/order', {
                                    state: {
                                      orderType: nextOrderType,
                                      menuId: defaultMenu.menuId,
                                      menuName: defaultMenu.menuName,
                                      orderId: orderId,
                                      customerName: orderListSelectedOrder.customer_name || '',
                                      customerPhone: orderListSelectedOrder.customer_phone || '',
                                      readyTimeLabel: orderListSelectedOrder.ready_time || '',
                                      fulfillmentMode: orderListSelectedOrder.fulfillment_mode || null,
                                    },
                                  });

                                  setShowOrderListModal(false);
                                }}
                                style={{ flex: 1, ...(isOnlineOrDelivery ? OH_ACTION_NEO.disabled : OH_ACTION_NEO.slate) }}
                                className={`rounded-xl py-4 text-sm font-bold touch-manipulation ${
                                  isOnlineOrDelivery
                                    ? 'cursor-not-allowed'
                                    : `text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`
                                }`}
                              >
                                Back to Order
                              </button>
                            );
                          })()}
                          {/* 2. Void */}
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const rawType = String(orderListSelectedOrder.order_type || '').toLowerCase();
                                const rawFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                const rawTableId = String(orderListSelectedOrder.table_id || '').toUpperCase();
                                const voidType =
                                  rawType.includes('delivery') || rawFulfillment.includes('delivery') || rawTableId.startsWith('DL')
                                    ? 'delivery'
                                    : rawType.includes('online')
                                    ? 'online'
                                    : rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                    ? 'togo'
                                    : 'pos';

                                const items = (orderListSelectedItems || []).map((it: any) => {
                                  let mods: any[] = [];
                                  try {
                                    if (it.modifiers_json) {
                                      mods = typeof it.modifiers_json === 'string' ? JSON.parse(it.modifiers_json) : it.modifiers_json;
                                    }
                                  } catch {}
                                  return { ...it, modifiers: mods };
                                });
                                const sels: Record<string, { checked: boolean; qty: number }> = {};
                                items.forEach((it: any) => {
                                  const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id);
                                  sels[key] = { checked: true, qty: it.quantity || 1 };
                                });

                                const sqliteVoidId = resolveSqliteOrderIdForVoid(orderListSelectedOrder, voidType);
                                const orderForVoid = {
                                  ...orderListSelectedOrder,
                                  id: sqliteVoidId ?? orderListSelectedOrder.id,
                                  number: orderListSelectedOrder.order_number || orderListSelectedOrder.number || sqliteVoidId || orderListSelectedOrder.id,
                                };
                                setTogoVoidOrder(orderForVoid);
                                setTogoVoidOrderType(voidType);
                                setTogoVoidItems(items);
                                setTogoVoidSelections(sels);
                                setTogoVoidPin('');
                                setTogoVoidPinError('');
                                setTogoVoidReason('');
                                setTogoVoidReasonPreset('');
                                setTogoVoidNote('');
                                setTogoVoidLoading(false);
                                setShowTogoVoidModal(true);
                              } catch (e) {
                                console.error('[Order History Void] Failed to open void modal:', e);
                                alert('Failed to open void.');
                              }
                            }}
                            style={{ flex: 1, ...OH_ACTION_NEO.red }}
                            className={`rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                          >
                            Void
                          </button>
                          {/* 3. Reprint */}
                          <button
                            type="button"
                            onClick={handleOrderListPrintKitchen}
                            style={{ flex: 1, ...OH_ACTION_NEO.orange }}
                            className={`rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                          >
                            Reprint
                          </button>
                          {/* 4. Print Bill */}
                          <button
                            type="button"
                            onClick={handleOrderListPrintBill}
                            style={{ flex: 1, ...OH_ACTION_NEO.blue }}
                            className={`rounded-xl py-4 text-sm font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                          >
                            Print Bill
                          </button>
                          {/* 4.5. Print Receipt - only enabled for paid orders */}
                          {(() => {
                            const isPaid = orderListSelectedOrder?.status === 'paid' || orderListSelectedOrder?.status === 'closed' || orderListSelectedOrder?.status === 'completed' || orderListSelectedOrder?.status === 'PAID' ||
                              orderListSelectedOrder?.paymentStatus === 'PAID' || orderListSelectedOrder?.paymentStatus === 'paid' || orderListSelectedOrder?.paymentStatus === 'completed' || orderListSelectedOrder?.paymentStatus === 'COMPLETED' ||
                              (orderListSelectedOrder as any)?.paid === true;
                            return (
                              <button
                                type="button"
                                onClick={isPaid ? handleOrderListPrintReceipt : undefined}
                                disabled={!isPaid}
                                style={{ flex: 1, ...(isPaid ? OH_ACTION_NEO.emerald : OH_ACTION_NEO.disabled) }}
                                className={`rounded-xl py-4 text-sm font-bold touch-manipulation ${
                                  isPaid ? `text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT}` : 'cursor-not-allowed'
                                }`}
                              >
                                Print Receipt
                              </button>
                            );
                          })()}
                          {/* 5. Pay */}
                          {(() => {
                            const status = (orderListSelectedOrder.status || '').toLowerCase();
                            const paymentStatus = (orderListSelectedOrder.paymentStatus || '').toLowerCase();
                            const _pType = (orderListSelectedOrder.order_type || '').toUpperCase();
                            const _pTableId = (orderListSelectedOrder.table_id || '').toString().toUpperCase();
                            const isOnline =
                              _pType === 'UBEREATS' || _pType === 'UBER' || _pType === 'DOORDASH' || _pType === 'SKIP' || _pType === 'SKIPTHEDISHES' ||
                              _pType === 'ONLINE' || _pType === 'WEB' || _pType === 'QR' || _pTableId.startsWith('OL');
                            const isPaid = !isOnline && (
                              status === 'paid' || status === 'closed' || status === 'completed' || 
                              paymentStatus === 'paid' || paymentStatus === 'completed' ||
                              orderListSelectedOrder.paid === true
                            );
                            return (
                              <button
                                type="button"
                                disabled={isPaid}
                                onClick={async () => {
                                  if (isPaid) return;
                                  try {
                                    const orderId = Number(orderListSelectedOrder.id);
                                    if (!Number.isFinite(orderId)) return;
                                    const rawType = String(orderListSelectedOrder.order_type || '').toLowerCase();
                                    const rawFulfillment = String(orderListSelectedOrder.fulfillment_mode || '').toLowerCase();
                                    const nextOrderType =
                                      rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
                                        ? 'togo'
                                        : rawType.includes('online')
                                        ? 'online'
                                        : 'pos';
                                    navigate('/sales/order', {
                                      state: {
                                        orderType: nextOrderType,
                                        menuId: defaultMenu.menuId,
                                        menuName: defaultMenu.menuName,
                                        orderId,
                                        customerName: orderListSelectedOrder.customer_name || '',
                                        customerPhone: orderListSelectedOrder.customer_phone || '',
                                        readyTimeLabel: orderListSelectedOrder.ready_time || '',
                                        fulfillmentMode: orderListSelectedOrder.fulfillment_mode || null,
                                        openPayment: true,
                                        fromOrderHistory: true,
                                      },
                                    });
                                    setShowOrderListModal(false);
                                  } catch (e) {
                                    console.error('[Order History Pay] Failed to open payment modal:', e);
                                    alert('Failed to open payment modal.');
                                  }
                                }}
                                style={{ flex: 1, ...(isPaid ? OH_ACTION_NEO.disabled : OH_ACTION_NEO.green) }}
                                className={`rounded-xl py-4 text-sm font-bold touch-manipulation ${
                                  isPaid ? 'cursor-not-allowed' : `text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`
                                }`}
                              >
                                Pay
                              </button>
                            );
                          })()}
                          </>
                          )}
                        </div>

                        {/* Channel Header - ë²„íŠ¼ ì•„ëž˜ë¡œ ì´ë™ (ë†’ì´ 10% ê°ì†Œ) */}
                        <div className="px-4 py-2 bg-slate-100 border-b border-gray-300 flex-shrink-0">
                          {(() => {
                            const badge = orderListGetChannelBadge(orderListSelectedOrder);
                            const oType = (orderListSelectedOrder.order_type || '').toUpperCase();
                            const { company: dCompany, orderNumber: dOrderNum } = orderListGetDeliveryMeta(orderListSelectedOrder);
                            const dCompanyStr = String(dCompany || '').toUpperCase().replace(/\s+/g, '');
                            const dNum = String(dOrderNum || '').replace(/^#/, '').trim();

                            let channelName = badge.label;
                            let channelOrderNum = '';

                            if (badge.label === 'ONLINE' || badge.label === 'UBER' || badge.label === 'DDASH' || badge.label === 'SKIP' || badge.label === 'FTUAN' || badge.label === 'DLV' || badge.label === 'Delivery' || badge.label === 'DELIVERY') {
                              if (dCompanyStr === 'UBEREATS' || dCompanyStr === 'UBER' || oType === 'UBEREATS' || oType === 'UBER') {
                                channelName = 'UberEATS';
                              } else if (dCompanyStr === 'DOORDASH' || dCompanyStr === 'DOORASH' || oType === 'DOORDASH') {
                                channelName = 'Doordash';
                              } else if (dCompanyStr === 'SKIPTHEDISHES' || dCompanyStr === 'SKIP' || oType === 'SKIP' || oType === 'SKIPTHEDISHES') {
                                channelName = 'SkipTheDishes';
                              } else if (dCompanyStr === 'FANTUAN' || oType === 'FANTUAN') {
                                channelName = 'Fantuan';
                              } else if (oType === 'DELIVERY') {
                                channelName = 'Delivery';
                              } else {
                                channelName = 'Online';
                              }
                              channelOrderNum =
                                dNum ||
                                orderListSelectedOrder.online_order_number ||
                                orderListSelectedOrder.deliveryOrderNumber ||
                                orderListParseChannelOrderFromLabel(orderListSelectedOrder.customer_name) ||
                                orderListParseChannelOrderFromLabel(orderListSelectedOrder.name) ||
                                '';
                              if (!channelOrderNum) {
                                const tid = String(orderListSelectedOrder.table_id || '').toUpperCase();
                                if (tid.startsWith('OL') || tid.startsWith('DL')) {
                                  const suffix = tid.substring(2).trim();
                                  // DL 뒤 숫자는 보통 delivery_orders.id(Date.now) — 내부용이면 채널 주문번호로 표시하지 않음
                                  if (suffix && !orderListIsInternalDeliveryMetaId(suffix)) channelOrderNum = suffix;
                                }
                              }
                              if (!channelOrderNum && channelName === 'Online' && orderListSelectedOrder.customer_name) {
                                channelOrderNum = orderListSelectedOrder.customer_name;
                              }
                            } else if (badge.label === 'TOGO' || badge.label === 'PICKUP') {
                              channelName = 'TOGO';
                              const rawPhone = String(orderListSelectedOrder.customer_phone || '').replace(/\D/g, '');
                              if (rawPhone.length >= 4) {
                                channelOrderNum = rawPhone.slice(-4);
                              } else if (orderListSelectedOrder.customer_name) {
                                channelOrderNum = String(orderListSelectedOrder.customer_name).slice(0, 10);
                              }
                            } else if (badge.label === 'DINE-IN' || badge.label === 'EAT IN') {
                              const tbl = orderListSelectedOrder.table_name || '';
                              const base = badge.label === 'DINE-IN' ? 'Dine-in' : 'Eat In';
                              if (tbl) channelName = `${base}  ${tbl}`;
                              else channelName = base;
                            }

                            const posNumber = orderListSelectedOrder.order_number || String(orderListSelectedOrder.id).padStart(3, '0');

                            return (
                              <div className="flex items-center justify-center gap-3">
                                <span className={`inline-block px-4 py-1.5 rounded-lg text-base font-bold ${badge.bgColor} ${badge.textColor}`}>
                                  {channelName}{channelOrderNum ? ` / ${channelOrderNum}` : ''}
                                </span>
                                <span className="text-sm font-bold text-gray-500">#{posNumber}</span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Order Info Header (ë†’ì´ 15% ê°ì†Œ) */}
                        <div className="px-4 py-1 bg-white border-b border-gray-200 text-sm flex-shrink-0">
                          <div className="flex justify-between items-center text-xs text-gray-600">
                            <span className="font-bold">Server: {orderListSelectedOrder.server_name || '-'}</span>
                            <span>{orderListFormatDate(orderListSelectedOrder.created_at)} {orderListFormatTime(orderListSelectedOrder.created_at)}</span>
                          </div>
                          {(orderListSelectedOrder.customer_name || orderListSelectedOrder.customer_phone) && (
                            <div className="text-xs text-gray-700 font-bold truncate mt-0.5">
                              Customer: {[orderListSelectedOrder.customer_name, orderListSelectedOrder.customer_phone].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Items List + Totals - í•¨ê»˜ ìŠ¤í¬ë¡¤ */}
                        <div 
                          className="flex-1 bg-white relative" 
                          style={{ 
                            overflowY: 'auto', 
                            overflowX: 'hidden',
                            overscrollBehavior: 'contain', 
                            WebkitOverflowScrolling: 'touch',
                            minHeight: 0,
                            maxHeight: '100%'
                          }}
                        >
                          <div className="px-4 py-1">
                            <table className="w-full text-sm" style={{ lineHeight: 1.2 }}>
                              <thead>
                                <tr className="border-b-2 border-gray-300 text-gray-700">
                                  <th className="text-left py-0.5 w-10 font-bold text-xs">Qty</th>
                                  <th className="text-left py-0.5 font-bold text-xs">Item</th>
                                  <th className="text-right py-0.5 w-16 font-bold text-xs">Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(orderListSelectedItems || []).map((item: any, idx: number) => {
                                  const rawModifiers = item.modifiers_json 
                                    ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) 
                                    : [];
                                  // ë‹¤ì–‘í•œ modifier í˜•ì‹ ì²˜ë¦¬
                                  const modifierNames: string[] = [];
                                  if (Array.isArray(rawModifiers)) {
                                    rawModifiers.forEach((m: any) => {
                                      if (typeof m === 'string') {
                                        modifierNames.push(m);
                                      } else if (m?.name) {
                                        modifierNames.push(m.name);
                                      } else if (m?.modifierNames && Array.isArray(m.modifierNames)) {
                                        modifierNames.push(...m.modifierNames);
                                      } else if (m?.selectedEntries && Array.isArray(m.selectedEntries)) {
                                        m.selectedEntries.forEach((entry: any) => {
                                          if (typeof entry === 'string') modifierNames.push(entry);
                                          else if (entry?.name) modifierNames.push(entry.name);
                                        });
                                      } else if (m?.groupName) {
                                        modifierNames.push(m.groupName);
                                      }
                                    });
                                  }
                                  return (
                                    <tr key={idx} className="border-b border-gray-100">
                                      <td className="text-center font-medium text-sm" style={{ paddingTop: 2, paddingBottom: 2, verticalAlign: 'top' }}>{item.quantity || 1}</td>
                                      <td style={{ paddingTop: 2, paddingBottom: 2 }}>
                                        <div className="font-medium text-sm" style={{ lineHeight: 1.15 }}>
                                          {item.name}
                                        </div>
                                        {!!item.togo_label && (
                                          <div className="text-xs text-orange-500 font-semibold italic ml-1" style={{ lineHeight: 1.1 }}>{'<Togo>'}</div>
                                        )}
                                        {modifierNames.length > 0 && (() => {
                                          const grouped: Array<{ name: string; count: number }> = [];
                                          modifierNames.forEach(n => {
                                            const existing = grouped.find(g => g.name === n);
                                            if (existing) existing.count++;
                                            else grouped.push({ name: n, count: 1 });
                                          });
                                          const itemQty = item.quantity || 1;
                                          return (
                                            <div className="text-xs text-gray-500 ml-2" style={{ lineHeight: 1.1 }}>
                                              {grouped.map((g, mi) => (
                                                <div key={mi}>· {(g.count * itemQty) > 1 ? `${g.count * itemQty}x ` : ''}{g.name}</div>
                                              ))}
                                            </div>
                                          );
                                        })()}
                                        {(() => {
                                          let memoText = '';
                                          try {
                                            if (item.memo_json) {
                                              const parsed = typeof item.memo_json === 'string' ? JSON.parse(item.memo_json) : item.memo_json;
                                              memoText = parsed?.text || (typeof parsed === 'string' ? parsed : '');
                                            }
                                          } catch {}
                                          return memoText ? (
                                            <div className="text-xs text-amber-600 ml-2 italic" style={{ lineHeight: 1.1 }}>* {memoText}</div>
                                          ) : null;
                                        })()}
                                        {item.discountPercent > 0 && (
                                          <div className="text-xs text-green-600 ml-2 font-medium" style={{ lineHeight: 1.1 }}>
                                            🎁 {item.discountPercent}% off {item.promotionName && `(${item.promotionName})`}
                                          </div>
                                        )}
                                      </td>
                                      <td className="text-right font-medium text-sm" style={{ paddingTop: 2, paddingBottom: 2, verticalAlign: 'top' }}>
                                        {item.discountAmount > 0 ? (
                                          <div style={{ lineHeight: 1.1 }}>
                                            <span className="line-through text-gray-400 text-xs">{`$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`}</span>
                                            <div className="text-green-600">{`$${(((item.price || 0) * (item.quantity || 1)) - item.discountAmount).toFixed(2)}`}</div>
                                          </div>
                                        ) : (
                                          `$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {/* VOID 아이템 표시 (취소선 + VOID 라벨) */}
                                {orderListVoidLines.length > 0 && (
                                  <>
                                    <tr><td colSpan={3} className="text-center text-xs font-bold text-red-600 py-1" style={{ borderTop: '1px dashed #ef4444' }}>VOID</td></tr>
                                    {orderListVoidLines.map((vl: any, vi: number) => (
                                      <tr key={`void-${vi}`} className="border-b border-red-100 bg-red-50">
                                        <td className="text-center font-medium text-sm text-red-400" style={{ paddingTop: 2, paddingBottom: 2, textDecoration: 'line-through' }}>{vl.qty || 1}</td>
                                        <td style={{ paddingTop: 2, paddingBottom: 2 }}>
                                          <div className="font-medium text-sm text-red-400" style={{ lineHeight: 1.15, textDecoration: 'line-through' }}>{vl.name}</div>
                                          {vl.reason && (
                                            <div className="text-xs text-red-300 ml-2" style={{ lineHeight: 1.1 }}>
                                              Reason: {vl.reason}
                                            </div>
                                          )}
                                        </td>
                                        <td className="text-right font-medium text-sm text-red-400" style={{ paddingTop: 2, paddingBottom: 2, textDecoration: 'line-through' }}>
                                          {`-$${(Number(vl.amount || 0)).toFixed(2)}`}
                                        </td>
                                      </tr>
                                    ))}
                                  </>
                                )}
                              </tbody>
                            </table>
                          </div>

                          {/* Totals - ì•„ì´í…œê³¼ í•¨ê»˜ ìŠ¤í¬ë¡¤ */}
                          {totals && (
                            <div className="px-4 py-1 bg-slate-100 border-t-2 border-gray-300 text-sm">
                              <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                <span className="font-medium text-xs">Sub Total:</span>
                                <span className="font-medium text-xs">{`$${totals.subtotal.toFixed(2)}`}</span>
                              </div>
                              {totals.discountTotal > 0 && (
                                <>
                                  <div className="flex justify-between text-green-600" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                    <span className="font-medium text-xs">{totals.promotionName === 'Item Discount' ? 'ðŸ·ï¸' : '🎁'} {(totals.promotionName || 'Discount').replace(/^Discount\b/, 'D/C')}:</span>
                                    <span className="font-medium text-xs">{`-$${totals.discountTotal.toFixed(2)}`}</span>
                                  </div>
                                  <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                    <span className="font-medium text-xs">Net Sales:</span>
                                    <span className="font-medium text-xs">{`$${totals.subtotalAfterDiscount.toFixed(2)}`}</span>
                                  </div>
                                </>
                              )}
                              {(totals.taxLines && totals.taxLines.length > 0) ? (
                                totals.taxLines.map((tl: any, ti: number) => (
                                  <div key={ti} className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                    <span className="font-medium text-xs">{tl.name}:</span>
                                    <span className="font-medium text-xs">{`$${tl.amount.toFixed(2)}`}</span>
                                  </div>
                                ))
                              ) : (
                                <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                  <span className="font-medium text-xs">Tax:</span>
                                  <span className="font-medium text-xs">{`$${totals.tax.toFixed(2)}`}</span>
                                </div>
                              )}
                              <div className="flex justify-between py-0.5 font-bold text-base border-t-2 border-gray-400 mt-0.5">
                                <span>Total:</span>
                                <span>{`$${totals.total.toFixed(2)}`}</span>
                              </div>
                              <div className="flex justify-center py-1">
                                <span className={`px-5 py-1.5 rounded-lg text-sm font-bold ${
                                  orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID' ||
                                  orderListSelectedOrder.paymentStatus === 'PAID' || orderListSelectedOrder.paymentStatus === 'paid' || orderListSelectedOrder.paymentStatus === 'completed' || orderListSelectedOrder.paymentStatus === 'COMPLETED' ||
                                  orderListSelectedOrder.paid === true
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-yellow-400 text-gray-800'
                                }`}>
                                  {orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID' ||
                                  orderListSelectedOrder.paymentStatus === 'PAID' || orderListSelectedOrder.paymentStatus === 'paid' || orderListSelectedOrder.paymentStatus === 'completed' || orderListSelectedOrder.paymentStatus === 'COMPLETED' ||
                                  orderListSelectedOrder.paid === true ? 'PAID' : 'UNPAID'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                )}

                {/* Content - Live Order Tab (hidden in pickup mode) */}
                {orderListOpenMode !== 'pickup' && orderListTab === 'live' && (
                <div className="flex-1 p-3 overflow-hidden flex flex-col">
                  {/* í•˜ì´ë¼ì´íŠ¸ëœ ì•„ì´í…œì´ ìžˆëŠ” í…Œì´ë¸” ëª©ë¡ í‘œì‹œ */}
                  {liveOrderHighlightItem && (() => {
                    const tablesWithItem = liveOrders
                      .filter((order: any) => 
                        order.items?.some((item: any) => item.name === liveOrderHighlightItem)
                      )
                      .map((order: any) => order.tableLabel)
                      .sort((a: string, b: string) => {
                        const numA = parseInt((a || '').replace(/\D/g, '') || '9999');
                        const numB = parseInt((b || '').replace(/\D/g, '') || '9999');
                        return numA - numB;
                      });
                    
                    if (tablesWithItem.length <= 1) return null;
                    
                    return (
                      <div className="mb-3 p-3 bg-red-50 border-2 border-red-300 rounded-xl flex items-center gap-3 flex-shrink-0">
                        <span className="text-red-600 font-bold text-sm">📍 "{liveOrderHighlightItem}"</span>
                        <span className="text-gray-600 text-sm">found in:</span>
                        <div className="flex flex-wrap gap-2">
                          {tablesWithItem.map((tableLabel: string) => (
                            <button
                              key={tableLabel}
                              onClick={() => {
                                // í•´ë‹¹ í…Œì´ë¸”ë¡œ ìŠ¤í¬ë¡¤
                                const order = liveOrders.find((o: any) => o.tableLabel === tableLabel);
                                if (order) {
                                  const cardEl = liveOrderCardRefs.current[order.tableId];
                                  if (cardEl) {
                                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }
                                }
                              }}
                              className="px-3 py-1 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 transition-all"
                            >
                              {tableLabel}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setLiveOrderHighlightItem(null)}
                          className="ml-auto w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-400 text-gray-600 hover:text-white text-sm font-bold transition-all"
                        >
                          X
                        </button>
                      </div>
                    );
                  })()}
                  
                  <div className="grid grid-cols-4 gap-3 flex-1 overflow-y-auto" style={{ gridAutoRows: 'calc((100% - 12px) / 2)' }}>
                    {/* ê²°ì œ ì™„ë£Œë˜ì§€ ì•Šì€ í…Œì´ë¸” ì£¼ë¬¸ í‘œì‹œ - í…Œì´ë¸” ë²ˆí˜¸ ì˜¤ë¦„ì°¨ìˆœ */}
                    {liveOrders
                      .slice()
                      .sort((a: any, b: any) => {
                        // í…Œì´ë¸” ë¼ë²¨ì—ì„œ ìˆ«ìž ì¶”ì¶œí•˜ì—¬ ì •ë ¬ (T1, T2, Table 1, Table 2 ë“±)
                        const numA = parseInt((a.tableLabel || '').replace(/\D/g, '') || '9999');
                        const numB = parseInt((b.tableLabel || '').replace(/\D/g, '') || '9999');
                        return numA - numB;
                      })
                      .map((liveOrder: any) => {
                        // ì´ í…Œì´ë¸”ì— í•˜ì´ë¼ì´íŠ¸ëœ ì•„ì´í…œì´ ìžˆëŠ”ì§€ í™•ì¸
                        const hasHighlightedItem = liveOrderHighlightItem && 
                          liveOrder.items?.some((item: any) => item.name === liveOrderHighlightItem);
                        
                        return (
                      <div
                        key={liveOrder.tableId}
                        ref={(el) => { liveOrderCardRefs.current[liveOrder.tableId] = el; }}
                        className={`bg-white rounded-xl border-2 shadow-lg p-3 flex flex-col overflow-hidden transition-all ${
                          hasHighlightedItem ? 'border-red-400 ring-2 ring-red-200' : 'border-gray-300'
                        }`}
                      >
                        {/* í…Œì´ë¸” ë²ˆí˜¸ í—¤ë” */}
                        <div className={`mb-2 flex-shrink-0 border-b pb-2 ${
                          hasHighlightedItem ? 'border-red-200' : 'border-gray-200'
                        }`}>
                          <span className={`text-xl font-bold ${
                            hasHighlightedItem ? 'text-red-600' : 'text-slate-700'
                          }`}>
                            {liveOrder.tableLabel}
                            {hasHighlightedItem && <span className="ml-2 text-sm text-red-500">*</span>}
                          </span>
                        </div>
                        
                        {/* ì£¼ë¬¸ ë‚´ì—­ - ìŠ¤í¬ë¡¤ ê°€ëŠ¥, ì•ŒíŒŒë²³ ì˜¤ë¦„ì°¨ìˆœ ì •ë ¬ */}
                        <div
                          className="flex-1 overflow-y-auto text-sm space-y-2 pr-1" 
                          style={{ minHeight: 0 }}
                        >
                          {liveOrder.items && liveOrder.items.length > 0 ? (
                            (() => {
                              const dine = liveOrder.items.filter((it: any) => !it.togo_label).slice().sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
                              const togo = liveOrder.items.filter((it: any) => !!it.togo_label).slice().sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
                              const all: any[] = [...dine, ...(togo.length > 0 ? [{ _togoSep: true }, ...togo] : [])];
                              return all;
                            })()
                              .map((item: any, idx: number) => {
                                if (item._togoSep) {
                                  return (
                                    <div key="togo-sep" className="flex items-center my-1">
                                      <div className="flex-1 border-t border-dashed border-gray-400" />
                                      <span className="px-2 text-[10px] font-semibold text-gray-500">TOGO</span>
                                      <div className="flex-1 border-t border-dashed border-gray-400" />
                                    </div>
                                  );
                                }
                                const isHighlighted = liveOrderHighlightItem === item.name;
                                return (
                              <div 
                                key={idx} 
                                data-item-name={item.name}
                                className={`border-b border-gray-100 pb-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-all ${
                                  isHighlighted ? 'bg-red-50 border-red-200' : ''
                                }`}
                                onClick={() => {
                                  // ê°™ì€ ì•„ì´í…œ í´ë¦­ ì‹œ í•´ì œ, ë‹¤ë¥¸ ì•„ì´í…œ í´ë¦­ ì‹œ í•˜ì´ë¼ì´íŠ¸
                                  if (liveOrderHighlightItem === item.name) {
                                    setLiveOrderHighlightItem(null);
                                  } else {
                                    setLiveOrderHighlightItem(item.name);
                                    // ë‹¤ë¥¸ í…Œì´ë¸” ì¹´ë“œì—ì„œ ê°™ì€ ì•„ì´í…œìœ¼ë¡œ ìŠ¤í¬ë¡¤
                                    setTimeout(() => {
                                      liveOrders.forEach((order: any) => {
                                        if (order.tableId === liveOrder.tableId) return;
                                        const cardEl = liveOrderCardRefs.current[order.tableId];
                                        if (cardEl) {
                                          const itemEl = cardEl.querySelector(`[data-item-name="${item.name}"]`);
                                          if (itemEl) {
                                            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          }
                                        }
                                      });
                                    }, 50);
                                  }
                                }}
                              >
                                {/* ë©”ë‰´ ì´ë¦„ & ìˆ˜ëŸ‰ */}
                                <div className="flex justify-between items-start">
                                  <span className={`leading-snug flex-1 ${
                                    isHighlighted ? 'text-red-600 font-bold' : 'font-semibold text-gray-800'
                                  }`}>
                                    {item.name}
                                  </span>
                                  <span className={`ml-2 ${
                                    isHighlighted ? 'text-red-600 font-bold' : 'text-gray-700 font-bold'
                                  }`}>x{item.quantity || 1}</span>
                                </div>
                                
                                {/* ëª¨ë””íŒŒì´ì–´ */}
                                {item.modifiers && item.modifiers.length > 0 && (
                                  <div className={`ml-3 text-xs leading-snug ${isHighlighted ? 'text-red-500' : 'text-blue-600'}`}>
                                    {item.modifiers.map((mod: any, mIdx: number) => {
                                      const label = typeof mod === 'string'
                                        ? mod
                                        : (mod?.name
                                          || (Array.isArray(mod?.modifierNames) ? mod.modifierNames.join(', ') : '')
                                          || (Array.isArray(mod?.selectedEntries) ? mod.selectedEntries.map((entry: any) => entry?.name || entry).filter(Boolean).join(', ') : '')
                                          || mod?.groupName
                                          || '');
                                      if (!label) return null;
                                      return <div key={mIdx}>+ {label}</div>;
                                    })}
                                  </div>
                                )}
                                
                                {/* Note (Memo) */}
                                {item.memo && (
                                  <div className={`ml-3 text-xs italic leading-snug ${isHighlighted ? 'text-red-500' : 'text-orange-600'}`}>
                                    📍 {typeof item.memo === 'string' ? item.memo : item.memo.text || JSON.stringify(item.memo)}
                                  </div>
                                )}
                              </div>
                              );
                            })
                          ) : (
                            <div className="text-gray-400 italic text-center py-2">No items</div>
                          )}
                        </div>
                        
                        {/* ì´ì•¡ */}
                        <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
                          <span className="text-xs text-gray-500">Total</span>
                          <span className="text-sm font-bold text-slate-800">
                            ${liveOrder.order?.total?.toFixed(2) || liveOrder.items?.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0).toFixed(2) || '0.00'}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                    
                    {/* ì£¼ë¬¸ì´ ì—†ì„ ë•Œ ì•ˆë‚´ ë©”ì‹œì§€ */}
                    {liveOrders.length === 0 && (
                      <div className="col-span-4 flex items-center justify-center h-48">
                        <span className="text-gray-400 text-lg">No active orders</span>
                      </div>
                    )}
                  </div>
                </div>
                )}

              </div>
            </div>
          );
        })()}
        <MoveMergeHistoryModal
          open={showMoveHistory}
          onClose={() => setShowMoveHistory(false)}
          API_URL={API_URL}
        />
        <SimplePartialSelectionModal
          isOpen={isSelectionModalOpen}
          tableId={sourceSelectionInfo?.tableId || ''}
          tableLabel={sourceSelectionInfo?.label || ''}
          orderId={sourceSelectionInfo?.orderId}
          onClose={handlePartialModalClose}
          onConfirm={handlePartialModalConfirm}
        />
          </div>
        </div>
        )}
      </div>

      {/* ëª¨ë‹¬ë“¤ */}
      <ServerSelectionModal
        open={showServerSelectionModal}
        loading={serverModalLoading}
        error={serverModalError}
        employees={clockedInServers}
        onClose={handleServerModalClose}
        onSelect={handleServerSelectionSelect}
      />
      {isBistroSalesRoute ? (
        <BistroContainerModal
          open={bistroContainerModalOpen}
          onClose={() => setBistroContainerModalOpen(false)}
          containerId={bistroContainerModalId}
          containerTitle={bistroContainerTitle}
          containerOrders={bistroContainerModalOrders}
          onRefreshOrders={() => {
            void loadBistroSessionOrders();
            void fetchTableMapData(false);
          }}
          onOpenOrder={(orderId, tableId) => {
            const sess = loadServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID);
            const sid =
              sess?.serverId ||
              (selectedTogoServer?.employee_id != null ? String(selectedTogoServer.employee_id) : '');
            const sname =
              (sess?.serverName && String(sess.serverName).trim()) ||
              (selectedTogoServer?.employee_name && String(selectedTogoServer.employee_name).trim()) ||
              '';
            navigate('/sales/order', {
              state: {
                orderType: 'POS',
                menuId: defaultMenu.menuId,
                menuName: defaultMenu.menuName,
                tableId,
                orderId: String(orderId),
                loadExisting: true,
                fromBistro: true,
                floor: selectedFloor,
                ...(sid && sname ? { serverId: sid, serverName: sname } : {}),
              },
            });
          }}
        />
      ) : null}
      <PaymentModal />
      <WaitingListModal
        open={showWaitingModal}
        onClose={() => setShowWaitingModal(false)}
        onTableStatusChanged={handleGuestFlowTableStatusChanged}
        onAssignTable={(entry) => {
          // Enable assign-from-waiting mode; next table click will reserve it for this entry
          setSelectedWaitingEntry(entry);
        }}
      />

      {/* Delivery ì „ìš© ëª¨ë‹¬ */}
      {showDeliveryOrderModal && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black bg-opacity-70 p-2 pt-2 sm:p-3">
          <div
            className="flex min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden border-0"
            style={{ ...PAY_NEO.modalShell, maxWidth: '1000px', height: '96vh', maxHeight: '760px' }}
          >
            <div className="flex flex-shrink-0 items-center justify-end px-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeliveryOrderModal(false)}
                className={`flex h-11 w-11 items-center justify-center rounded-full border-0 text-red-600 transition-all hover:brightness-[1.03] touch-manipulation ${NEO_MODAL_BTN_PRESS}`}
                style={{ ...PAY_NEO.key, borderRadius: 9999 }}
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="flex flex-shrink-0 items-center justify-between px-5 py-3" style={{ ...PAY_NEO.raised, borderRadius: 0 }}>
              <h3 className="text-lg font-extrabold text-slate-800">New Delivery</h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowDeliveryOrderModal(false)} className={`rounded-[14px] border-0 px-4 py-3 font-bold text-gray-700 transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={PAY_NEO.inset}>Cancel</button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!deliveryCompany) { alert('Select channel'); return; }
                    if (!deliveryOrderNumber.trim()) { alert('Enter order #'); return; }
                    const clockApplied = applyDeliveryClockIfProvided();
                    const minutesForOrder = clockApplied?.minutes ?? deliveryPrepTime;
                    const readyTimeLabel = clockApplied?.readyLabel ?? computeDeliveryReadyLabel(minutesForOrder);
                    const deliveryOrderNumberTrimmed = deliveryOrderNumber.trim();
                    const newOrder = {
                      id: Date.now(),
                      type: 'Delivery',
                      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                      createdAt: getLocalDatetimeString(),
                      phone: '',
                      name: `${deliveryCompany} #${deliveryOrderNumberTrimmed}`,
                      status: 'pending',
                      serverId: null,
                      serverName: '',
                      items: [],
                      orderItems: [],
                      fulfillment: 'delivery',
                      deliveryCompany,
                      deliveryOrderNumber: deliveryOrderNumberTrimmed,
                      readyTimeLabel,
                      prepTime: minutesForOrder,
                      service_pattern: 'TAKEOUT',
                    };
                    setTogoOrders(prev => [...prev, newOrder]);
                    try {
                      await fetch(`${API_URL}/orders/delivery-orders`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ storeId: 'STORE001', ...newOrder }),
                      });
                    } catch (err) {
                      console.error('❌ Failed to save delivery order:', err);
                    }
                    setShowDeliveryOrderModal(false);
                    navigate('/sales/order', {
                      state: {
                        tableId: `DL${newOrder.id}`,
                        tableName: newOrder.name,
                        channel: 'delivery',
                        orderType: 'delivery',
                        fulfillmentMode: 'delivery',
                        priceType: 'price2',
                        menuId: defaultMenu.menuId,
                        menuName: defaultMenu.menuName,
                        deliveryMetaId: newOrder.id,
                        deliveryCompany,
                        deliveryOrderNumber: deliveryOrderNumberTrimmed,
                        readyTimeLabel,
                        pickup: { minutes: minutesForOrder },
                      },
                    });
                  }}
                  disabled={!deliveryCompany || !deliveryOrderNumber.trim()}
                  className={`rounded-[14px] border-0 px-5 py-3 font-bold transition-all hover:brightness-[1.02] disabled:cursor-not-allowed touch-manipulation ${NEO_MODAL_BTN_PRESS}`}
                  style={
                    deliveryCompany && deliveryOrderNumber.trim()
                      ? PAY_NEO_PRIMARY_BLUE
                      : { ...PAY_NEO.inset, opacity: 0.55, cursor: 'not-allowed', color: '#64748b' }
                  }
                >
                  OK
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col" style={{ background: PAY_NEO_CANVAS }}>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-2 pt-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {/* Left: order # + channel */}
              <div className="min-h-0 min-w-0 space-y-2">
                <div className="rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="mb-2 text-xs font-semibold text-slate-600">Order #</div>
                  <div className="flex min-w-0 items-stretch gap-2">
                    {(() => {
                      const b =
                        deliveryCompany &&
                        DELIVERY_ORDER_MODAL_CHANNEL_BADGE[
                          deliveryCompany as keyof typeof DELIVERY_ORDER_MODAL_CHANNEL_BADGE
                        ];
                      if (!b) return null;
                      return (
                        <span
                          className="flex shrink-0 items-center px-1 text-base font-extrabold leading-none tracking-tight"
                          style={{ color: b.color }}
                        >
                          {b.label}
                        </span>
                      );
                    })()}
                    <input
                      type="text"
                      ref={deliveryOrderInputRef}
                      value={deliveryOrderNumber}
                      onChange={(e) => setDeliveryOrderNumber(e.target.value.toUpperCase())}
                      placeholder="Order #"
                      className="h-12 min-w-0 flex-1 rounded-[14px] border-0 px-3 text-center font-mono text-xl tracking-widest text-slate-800 focus:outline-none focus:ring-0"
                      style={PAY_NEO.inset}
                    />
                  </div>
                </div>

                <div className="rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="mb-2 text-xs font-semibold text-slate-600">Channel</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['UberEats', 'Doordash', 'SkipTheDishes', 'Fantuan'] as const).map((company) => {
                      const active = deliveryCompany === company;
                      // Uber Eats 브랜드 그린(공개 가이드·앱 톤에 가까운 #06C167 계열) — 짙은 그라데이션
                      const uberEatsChannelStyle: React.CSSProperties = active
                        ? {
                            background: 'linear-gradient(145deg, #12d47a, #06a050)',
                            color: '#ffffff',
                            boxShadow:
                              'inset 2px 2px 6px rgba(0,80,48,0.35), inset -1px -1px 4px rgba(255,255,255,0.2)',
                          }
                        : {
                            background: 'linear-gradient(145deg, #06C167, #047857)',
                            color: '#ffffff',
                            boxShadow: '2px 2px 0 0 rgba(3,90,58,0.5), -1px -1px 0 0 rgba(255,255,255,0.18)',
                          };
                      // DoorDash 공식 레드-오렌지 #FF3008(브랜드 배너·가이드 톤)
                      const doorDashChannelStyle: React.CSSProperties = active
                        ? {
                            background: 'linear-gradient(145deg, #ff4d38, #e62d0a)',
                            color: '#ffffff',
                            boxShadow:
                              'inset 2px 2px 6px rgba(120,20,0,0.38), inset -1px -1px 4px rgba(255,255,255,0.22)',
                          }
                        : {
                            background: 'linear-gradient(145deg, #FF3008, #c41f00)',
                            color: '#ffffff',
                            boxShadow: '2px 2px 0 0 rgba(160,30,10,0.5), -1px -1px 0 0 rgba(255,255,255,0.2)',
                          };
                      // SkipTheDishes 리브랜드 오렌지 #FF8000(공개 브랜드 팔레트 인용) — 순수 주황 그라데이션
                      const skipTheDishesChannelStyle: React.CSSProperties = active
                        ? {
                            background: 'linear-gradient(145deg, #ffa64d, #ff7700)',
                            color: '#ffffff',
                            boxShadow:
                              'inset 2px 2px 6px rgba(140,60,0,0.32), inset -1px -1px 4px rgba(255,255,255,0.25)',
                          }
                        : {
                            background: 'linear-gradient(145deg, #FF8000, #e55a00)',
                            color: '#ffffff',
                            boxShadow: '2px 2px 0 0 rgba(200,80,0,0.45), -1px -1px 0 0 rgba(255,255,255,0.22)',
                          };
                      // Fantuan 로고 배경 톤 — 터키석/틸(#17BDB8·#00C7C1 계열)
                      const fantuanChannelStyle: React.CSSProperties = active
                        ? {
                            background: 'linear-gradient(145deg, #3fe8e2, #17BDB8)',
                            color: '#ffffff',
                            boxShadow:
                              'inset 2px 2px 6px rgba(0,90,88,0.35), inset -1px -1px 4px rgba(255,255,255,0.28)',
                          }
                        : {
                            background: 'linear-gradient(145deg, #00C7C1, #0a9d98)',
                            color: '#ffffff',
                            boxShadow: '2px 2px 0 0 rgba(8,120,116,0.45), -1px -1px 0 0 rgba(255,255,255,0.22)',
                          };
                      return (
                      <button
                        key={company}
                        type="button"
                        onClick={() => setDeliveryCompany(company)}
                        className={`h-12 rounded-[14px] border-0 text-sm font-bold transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS} ${
                          company === 'UberEats'
                            ? active
                              ? 'ring-2 ring-emerald-200/90 text-white'
                              : 'text-white'
                            : company === 'Doordash'
                            ? active
                              ? 'ring-2 ring-red-200/95 text-white'
                              : 'text-white'
                            : company === 'SkipTheDishes'
                            ? active
                              ? 'ring-2 ring-orange-200/95 text-white'
                              : 'text-white'
                            : company === 'Fantuan'
                            ? active
                              ? 'ring-2 ring-cyan-200/95 text-white'
                              : 'text-white'
                            : active
                            ? 'ring-2 ring-emerald-400/70 text-slate-800'
                            : 'text-slate-700'
                        }`}
                        style={
                          company === 'UberEats'
                            ? uberEatsChannelStyle
                            : company === 'Doordash'
                            ? doorDashChannelStyle
                            : company === 'SkipTheDishes'
                            ? skipTheDishesChannelStyle
                            : company === 'Fantuan'
                            ? fantuanChannelStyle
                            : active
                            ? PAY_NEO.inset
                            : PAY_NEO.key
                        }
                      >
                        {company === 'SkipTheDishes' ? 'Skip' : company}
                      </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Right: prep time panels */}
              <div className="grid min-h-0 min-w-0 gap-1.5">
                {/* Panel 1: summary */}
                <div className="rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
                    <div className="flex min-w-0 items-center gap-2">
                      <span>Prep Time</span>
                      <span className="text-3xl font-mono font-semibold leading-none text-indigo-600">{deliveryPrepTime}m</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs sm:text-sm">
                      <span className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold whitespace-nowrap">
                        Ready {computeDeliveryReadyDisplay(deliveryPrepTime)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700 font-semibold whitespace-nowrap">
                        Current {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Panel 2: minute buttons */}
                <div className="rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap gap-2">
                      {[5, 10, 15, 20, 25].map((min) => (
                        <button
                          key={`del-top-${min}`}
                          type="button"
                          onClick={() => {
                            setDeliveryPrepTime(min);
                            try {
                              const d = new Date(Date.now() + min * 60000);
                              setDeliveryReadyHour(String(d.getHours()).padStart(2, '0'));
                              setDeliveryReadyMinute(String(d.getMinutes()).padStart(2, '0'));
                            } catch {}
                          }}
                          className={`flex h-10 min-w-[70px] items-center justify-center rounded-[14px] border-0 px-3 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                          style={min === 15 ? PAY_NEO_PRIMARY_BLUE : OH_ACTION_NEO.slate}
                        >
                          +{min}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[30, 40, 50, 60].map((min) => (
                        <button
                          key={`del-bottom-${min}`}
                          type="button"
                          onClick={() => {
                            setDeliveryPrepTime(min);
                            try {
                              const d = new Date(Date.now() + min * 60000);
                              setDeliveryReadyHour(String(d.getHours()).padStart(2, '0'));
                              setDeliveryReadyMinute(String(d.getMinutes()).padStart(2, '0'));
                            } catch {}
                          }}
                          className={`flex h-10 min-w-[70px] items-center justify-center rounded-[14px] border-0 px-3 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                          style={OH_ACTION_NEO.slate}
                        >
                          +{min}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Panel 3: manual HH:MM */}
                <div className="rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseInt(String(deliveryReadyHour || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) - 1;
                          setDeliveryReadyHour(String((next + 24) % 24).padStart(2, '0'));
                        }}
                        className={`h-[38px] w-[44px] rounded-[12px] border-0 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                        style={OH_ACTION_NEO.blue}
                      >
                        -H
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={deliveryReadyHour}
                        readOnly
                        onClick={() => openTimePicker('DELIVERY_HOUR')}
                        onChange={(e) => {
                          const digits = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 2);
                          const n = digits === '' ? NaN : parseInt(digits, 10);
                          if (!Number.isFinite(n)) { setDeliveryReadyHour(digits); return; }
                          setDeliveryReadyHour(String(Math.max(0, Math.min(23, n))).padStart(2, '0'));
                        }}
                        placeholder="HH"
                        className="h-[38px] w-[54px] rounded-[12px] border-0 px-2 text-center font-mono text-sm text-slate-800 focus:outline-none focus:ring-0"
                        style={PAY_NEO.inset}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseInt(String(deliveryReadyHour || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) + 1;
                          setDeliveryReadyHour(String(next % 24).padStart(2, '0'));
                        }}
                        className={`h-[38px] w-[44px] rounded-[12px] border-0 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                        style={OH_ACTION_NEO.blue}
                      >
                        +H
                      </button>
                    </div>
                    <span className="text-slate-500">:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseInt(String(deliveryReadyMinute || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) - 1;
                          const norm = ((next % 60) + 60) % 60;
                          setDeliveryReadyMinute(String(norm).padStart(2, '0'));
                        }}
                        className={`h-[38px] w-[44px] rounded-[12px] border-0 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                        style={OH_ACTION_NEO.emerald}
                      >
                        -M
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={deliveryReadyMinute}
                        readOnly
                        onClick={() => openTimePicker('DELIVERY_MINUTE')}
                        onChange={(e) => {
                          const digits = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 2);
                          const n = digits === '' ? NaN : parseInt(digits, 10);
                          if (!Number.isFinite(n)) { setDeliveryReadyMinute(digits); return; }
                          setDeliveryReadyMinute(String(Math.max(0, Math.min(59, n))).padStart(2, '0'));
                        }}
                        placeholder="MM"
                        className="h-[38px] w-[54px] rounded-[12px] border-0 px-2 text-center font-mono text-sm text-slate-800 focus:outline-none focus:ring-0"
                        style={PAY_NEO.inset}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseInt(String(deliveryReadyMinute || '0'), 10);
                          const next = (Number.isFinite(cur) ? cur : 0) + 1;
                          const norm = next % 60;
                          setDeliveryReadyMinute(String(norm).padStart(2, '0'));
                        }}
                        className={`h-[38px] w-[44px] rounded-[12px] border-0 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS}`}
                        style={OH_ACTION_NEO.emerald}
                      >
                        +M
                      </button>
                    </div>
                    <div className="text-xs font-semibold text-slate-600">Time (HH:MM)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Virtual Keyboard — inside modal card; parentFlow + negative margin so it sits in modal, 30px up */}
            <div className="-mt-[30px] flex-shrink-0 px-4 pb-3">
                <VirtualKeyboard
                  open={true}
                  onType={(char) => setDeliveryOrderNumber(prev => (prev + char).toUpperCase())}
                  onBackspace={() => setDeliveryOrderNumber(prev => prev.slice(0, -1))}
                  onClear={() => setDeliveryOrderNumber('')}
                  displayText={deliveryOrderNumber}
                  keepOpen={true}
                  showNumpad={true}
                  languages={['EN']}
                  currentLanguage="EN"
                  maxWidthPx={1000}
                  layoutMode="parentFlow"
                />
            </div>
            </div>
          </div>
        </div>
      )}

      {timePickerTarget &&
        (() => {
          const isHour = String(timePickerTarget).endsWith('HOUR');
          const currentValue =
            timePickerTarget === 'TOGO_HOUR'
              ? togoReadyHour
              : timePickerTarget === 'TOGO_MINUTE'
              ? togoReadyMinute
              : timePickerTarget === 'DELIVERY_HOUR'
              ? deliveryReadyHour
              : deliveryReadyMinute;

          const apply = (val: string) => {
            if (timePickerTarget === 'TOGO_HOUR') setTogoReadyHour(val);
            else if (timePickerTarget === 'TOGO_MINUTE') setTogoReadyMinute(val);
            else if (timePickerTarget === 'DELIVERY_HOUR') setDeliveryReadyHour(val);
            else if (timePickerTarget === 'DELIVERY_MINUTE') setDeliveryReadyMinute(val);
            closeTimePicker();
          };

          const hourOptions = Array.from({ length: 13 }, (_, i) => 11 + i).map((h24) => {
            const label = h24 === 11 ? '11 AM' : h24 === 12 ? '12 PM' : `${h24 - 12} PM`;
            const value = String(h24).padStart(2, '0');
            return { label, value };
          });
          const minuteOptions = ['00', '15', '30', '45'].map((m) => ({ label: m, value: m }));
          const options = isHour ? hourOptions : minuteOptions;

          return (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
              onClick={closeTimePicker}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl border border-slate-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-lg font-extrabold text-slate-800">
                    {isHour ? 'Select Hour' : 'Select Minute'}
                  </div>
                  <button
                    type="button"
                    onClick={closeTimePicker}
                    className="px-3 h-9 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>

                <div className={`grid gap-2 ${isHour ? 'grid-cols-3' : 'grid-cols-4'}`}>
                  {options.map((opt) => {
                    const active = String(opt.value) === String(currentValue);
                    return (
                      <button
                        key={`${isHour ? 'h' : 'm'}-${opt.value}`}
                        type="button"
                        onClick={() => apply(opt.value)}
                        className={`h-12 rounded-xl font-bold border shadow-sm transition ${
                          active
                            ? 'bg-emerald-600 border-emerald-700 text-white'
                            : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}


      {/* Online/Togo ê²°ì œ ëª¨ë‹¬ - z-indexë¥¼ ë” ë†’ê²Œ ì„¤ì • */}
      <div style={{ position: 'relative', zIndex: 60 }}>
      <TablePaymentModal
        key={`ot-pay-${String(onlineTogoPaymentOrder?.id ?? 'x')}-${Number(onlineTogoPaymentOrder?.total ?? 0)}-${showOnlineTogoPaymentModal ? '1' : '0'}`}
        isOpen={showOnlineTogoPaymentModal}
        onClose={() => {
          disarmPanelTogoPayKitchenSuppress();
          setShowOnlineTogoPaymentModal(false);
          setOnlineTogoPaymentOrder(null);
          // ê²°ì œ ì„¸ì…˜ ì´ˆê¸°í™”
          setOnlineTogoSessionPayments([]);
          onlineTogoSavedOrderIdRef.current = null;
        }}
        subtotal={Number(onlineTogoPaymentOrder?.subtotal ?? 0) || 0}
        taxLines={
          (onlineTogoPaymentOrder as any)?.taxLines ||
          (onlineTogoPaymentOrder?.tax != null
            ? [{ name: 'Tax', amount: Number(onlineTogoPaymentOrder.tax) || 0 }]
            : [])
        }
        total={Number(onlineTogoPaymentOrder?.total ?? 0) || 0}
        channel={onlineTogoPaymentOrder?.type?.toLowerCase() || 'togo'}
        customerName={onlineTogoPaymentOrder?.name || ''}
        tableName={`${onlineTogoPaymentOrder?.type || 'Order'} #${onlineTogoPaymentOrder?.number || ''}`}
        payments={onlineTogoSessionPayments}
        outstandingDue={(() => {
          const total = onlineTogoPaymentOrder?.total || 0;
          const paidSum = onlineTogoSessionPayments.reduce((s, p) => s + (p.amount || 0), 0);
          return Math.max(0, Number((total - paidSum).toFixed(2)));
        })()}
        paidSoFar={onlineTogoSessionPayments.reduce((s, p) => s + (p.amount || 0), 0)}
        onClearAllPayments={async () => {
          try {
            const ids = onlineTogoSessionPayments.map(p => p.paymentId).filter((id) => typeof id === 'number' && Number.isFinite(id));
            for (const pid of ids) {
              try {
                await fetch(`${API_URL}/payments/${pid}/void`, { method: 'POST' });
              } catch {}
            }
          } finally {
            setOnlineTogoSessionPayments([]);
          }
        }}
        onClearScopedPayments={async (paymentIds: number[]) => {
          const idSet = new Set((paymentIds || []).filter((id) => typeof id === 'number' && Number.isFinite(id)));
          if (idSet.size === 0) return;
          try {
            for (const pid of Array.from(idSet)) {
              try {
                await fetch(`${API_URL}/payments/${pid}/void`, { method: 'POST' });
              } catch {}
            }
          } finally {
            setOnlineTogoSessionPayments(prev => prev.filter(p => !idSet.has(p.paymentId)));
          }
        }}
        onConfirm={async (payload: { method: string; amount: number; tip: number; terminalRef?: string }) => {
          try {
            // Togo ì£¼ë¬¸ì˜ ê²½ìš° ì´ë¯¸ ë¡œì»¬ DBì— orderIdê°€ ìžˆìŒ
            // Online ì£¼ë¬¸ì˜ ê²½ìš° ë¡œì»¬ DBì— ì €ìž¥ë˜ì–´ ìžˆì§€ ì•Šìœ¼ë¯€ë¡œ ë¨¼ì € ì €ìž¥ í•„ìš”
            let orderId = onlineTogoSavedOrderIdRef.current;
            
            // selectedOrderType ëŒ€ì‹  onlineTogoPaymentOrder.orderType ì‚¬ìš© (í´ë¡œì € stale ê°’ ë°©ì§€)
            const orderType = onlineTogoPaymentOrder?.orderType;
            
            if (!orderId) {
              if ((orderType === 'togo' || orderType === 'forhere' || orderType === 'pickup') && onlineTogoPaymentOrder?.id) {
                // Togo/ForHere/Pickup: ì´ë¯¸ ë¡œì»¬ DBì— ìžˆìŒ
                orderId = onlineTogoPaymentOrder.id;
                onlineTogoSavedOrderIdRef.current = orderId;
              } else if (orderType === 'online' && onlineTogoPaymentOrder?.id) {
                // Online: ë¡œì»¬ DBì— ì£¼ë¬¸ ì €ìž¥
                const orderData = selectedOrderDetail?.fullOrder || onlineTogoPaymentOrder;
                const items = orderData?.items || [];
                const now = new Date();
                const orderNumber = `ONLINE-${onlineTogoPaymentOrder.number || now.getTime()}`;
                
                const saveRes = await fetch(`${API_URL}/orders`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    orderNumber,
                    orderType: 'ONLINE',
                    total: onlineTogoPaymentOrder.total || 0,
                    items: items.map((it: any) => ({
                      id: it.id || it.item_id,
                      name: it.name,
                      quantity: it.quantity || 1,
                      price: (it.price || 0) * (it.quantity || 1),
                      modifiers: it.modifiers || []
                    })),
                    customerName: onlineTogoPaymentOrder.name || '',
                    customerPhone: onlineTogoPaymentOrder.phone || ''
                  })
                });
                
                if (!saveRes.ok) throw new Error('Failed to save online order to local DB');
                const saved = await saveRes.json();
                orderId = saved.orderId;
                onlineTogoSavedOrderIdRef.current = orderId;
              }
            }
            
            if (!orderId) {
              console.error('No orderId available for payment');
              return;
            }
            
            // ê²°ì œ ì €ìž¥ API í˜¸ì¶œ (Dine-Inê³¼ ë™ì¼)
            const payRes = await fetch(`${API_URL}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId,
                method: payload.method,
                amount: Number((payload.amount + payload.tip).toFixed(2)),
                tip: payload.tip,
                guestNumber: null,
                ref: payload.terminalRef ?? null
              })
            });
            
            if (!payRes.ok) throw new Error('Failed to save payment');
            const payData = await payRes.json();
            
            // ë¡œì»¬ ì„¸ì…˜ì— ê²°ì œ ì¶”ê°€
            setOnlineTogoSessionPayments(prev => ([
              ...prev,
              {
                paymentId: payData.paymentId,
                method: payload.method,
                amount: Number((payload.amount + payload.tip).toFixed(2)),
                tip: payload.tip,
                ...(payload.terminalRef ? { terminalRef: payload.terminalRef } : {})
              }
            ]));
            
            console.log('Payment saved:', payData, 'for order:', orderId);
          } catch (e) {
            console.error('Payment processing error:', e);
            alert('An error occurred during payment processing.');
          }
        }}
        onPaymentComplete={(data: { change: number; total: number; tip: number; payments: Array<{ method: string; amount: number }>; hasCashPayment: boolean; discount?: { percent: number; amount: number; originalSubtotal: number; discountedSubtotal: number; taxLines: Array<{ name: string; amount: number }>; taxesTotal: number } }) => {
          // Dine-inê³¼ ë™ì¼: PaymentModalì´ ìž”ì•¡ 0 ê°ì§€ ì‹œ ìžë™ìœ¼ë¡œ í˜¸ì¶œ
          // Cash drawer ì¦‰ì‹œ ì˜¤í”ˆ
          try { fetch(`${API_URL}/printers/open-drawer`, { method: 'POST' }); } catch {}
          
          // Save change_amount to DB
          if (data.change > 0 && data.hasCashPayment && onlineTogoPaymentOrder?.id) {
            try { fetch(`${API_URL}/payments/order/${onlineTogoPaymentOrder.id}/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeAmount: data.change }) }); } catch {}
          }
          
          // ì™„ë£Œ ë°ì´í„° ì €ìž¥ (close handlerì—ì„œ ì‚¬ìš©)
          onlineTogoCompletionRef.current = {
            orderType: onlineTogoPaymentOrder?.orderType ?? selectedOrderType,
            orderId: onlineTogoPaymentOrder?.id,
            orderDetail: selectedOrderDetail,
            paymentOrder: { ...onlineTogoPaymentOrder },
            sessionPayments: [...onlineTogoSessionPayments],
            completePickupAfterPay: !!(onlineTogoPaymentOrder as any)?.__completePickupAfterPay,
          };
          
          // PaymentModal ë‹«ê³  PaymentCompleteModal ì—´ê¸°
          setShowOnlineTogoPaymentModal(false);
          setOnlineTogoPaymentCompleteData({
            change: data.change,
            total: data.total,
            tip: data.tip,
            payments: data.payments,
            hasCashPayment: data.hasCashPayment,
            discount: data.discount,
          });
          setShowOnlineTogoPaymentCompleteModal(true);
        }}
        onComplete={async () => {
          // Calculate change and payment info for PaymentCompleteModal
          // Change should be calculated from FOOD portion only (amount - tip).
          // This prevents "cash tip" from being misinterpreted as change.
          const cashFoodPaid = onlineTogoSessionPayments
            .filter(p => String(p.method || '').toUpperCase() === 'CASH')
            .reduce((s, p) => s + Math.max(0, (p.amount || 0) - ((p as any).tip || 0)), 0);
          const totalAmount = onlineTogoPaymentOrder?.total || 0;
          const nonCashFoodPaid = onlineTogoSessionPayments
            .filter(p => String(p.method || '').toUpperCase() !== 'CASH')
            .reduce((s, p) => s + Math.max(0, (p.amount || 0) - ((p as any).tip || 0)), 0);
          const changeAmount = Math.max(0, Number((cashFoodPaid - Math.max(0, totalAmount - nonCashFoodPaid)).toFixed(2)));
          const totalTip = onlineTogoSessionPayments.reduce((s, p) => s + (p.tip || 0), 0);
          const actualPayments = onlineTogoSessionPayments.length > 0
            ? onlineTogoSessionPayments.map(p => ({ method: p.method, amount: p.amount, tip: (p.tip || 0) }))
            : [{ method: 'PAID', amount: totalAmount }];
          const hasCash = onlineTogoSessionPayments.some(p => p.method === 'CASH');
          
          // Save completion data for the close handler
          onlineTogoCompletionRef.current = {
            orderType: onlineTogoPaymentOrder?.orderType ?? selectedOrderType,
            orderId: onlineTogoPaymentOrder?.id,
            orderDetail: selectedOrderDetail,
            paymentOrder: { ...onlineTogoPaymentOrder },
            sessionPayments: [...onlineTogoSessionPayments],
            completePickupAfterPay: !!(onlineTogoPaymentOrder as any)?.__completePickupAfterPay,
          };
          
          // Close PaymentModal, open PaymentCompleteModal
          setShowOnlineTogoPaymentModal(false);
          setOnlineTogoPaymentCompleteData({
            change: changeAmount,
            total: totalAmount,
            tip: totalTip,
            payments: actualPayments,
            hasCashPayment: hasCash,
          });
          setShowOnlineTogoPaymentCompleteModal(true);
        }}
      />
      </div>

      {/* Order History Payment Modal */}
      <div style={{ position: 'relative', zIndex: 70 }}>
        <TablePaymentModal
          isOpen={showOrderListPaymentModal}
          onClose={() => {
            setShowOrderListPaymentModal(false);
            setOrderListPaymentOrder(null);
            setOrderListPaymentSessionPayments([]);
          }}
          subtotal={Number(orderListPaymentOrder?.subtotal ?? 0)}
          taxLines={
            (orderListPaymentOrder as any)?.taxLines ||
            (Number(orderListPaymentOrder?.tax ?? 0) ? [{ name: 'Tax', amount: Number(orderListPaymentOrder?.tax ?? 0) }] : [])
          }
          total={Number(orderListPaymentOrder?.total ?? 0)}
          channel={String(orderListPaymentOrder?.orderType || orderListPaymentOrder?.type || 'pos').toLowerCase()}
          customerName={String(orderListPaymentOrder?.name || '')}
          tableName={`Order #${String(orderListPaymentOrder?.number ?? orderListPaymentOrder?.id ?? '')}`}
          payments={orderListPaymentSessionPayments}
          outstandingDue={(() => {
            const total = Number(orderListPaymentOrder?.total ?? 0);
            const paidSum = orderListPaymentSessionPayments.reduce((s, p) => s + (p.amount || 0), 0);
            return Math.max(0, Number((total - paidSum).toFixed(2)));
          })()}
          paidSoFar={orderListPaymentSessionPayments.reduce((s, p) => s + (p.amount || 0), 0)}
          onClearAllPayments={async () => {
            try {
              const ids = orderListPaymentSessionPayments
                .map((p) => p.paymentId)
                .filter((id) => typeof id === 'number' && Number.isFinite(id));
              for (const pid of ids) {
                try {
                  await fetch(`${API_URL}/payments/${pid}/void`, { method: 'POST' });
                } catch {}
              }
            } finally {
              setOrderListPaymentSessionPayments([]);
            }
          }}
          onClearScopedPayments={async (paymentIds: number[]) => {
            const idSet = new Set((paymentIds || []).filter((id) => typeof id === 'number' && Number.isFinite(id)));
            if (idSet.size === 0) return;
            try {
              for (const pid of Array.from(idSet)) {
                try {
                  await fetch(`${API_URL}/payments/${pid}/void`, { method: 'POST' });
                } catch {}
              }
            } finally {
              setOrderListPaymentSessionPayments((prev) => prev.filter((p) => !idSet.has(p.paymentId)));
            }
          }}
          onConfirm={async (payload: { method: string; amount: number; tip: number; terminalRef?: string }) => {
            try {
              const orderId = Number(orderListPaymentOrder?.id);
              if (!Number.isFinite(orderId)) return;

              const payRes = await fetch(`${API_URL}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId,
                  method: payload.method,
                  amount: Number((payload.amount + payload.tip).toFixed(2)),
                  tip: payload.tip,
                  guestNumber: null,
                  ref: payload.terminalRef ?? null,
                }),
              });
              if (!payRes.ok) throw new Error('Failed to save payment');
              const payData = await payRes.json();

              setOrderListPaymentSessionPayments((prev) => ([
                ...prev,
                {
                  paymentId: payData.paymentId,
                  method: payload.method,
                  amount: Number((payload.amount + payload.tip).toFixed(2)),
                  tip: payload.tip,
                  ...(payload.terminalRef ? { terminalRef: payload.terminalRef } : {}),
                },
              ]));
            } catch (e) {
              console.error('[Order History Pay] Payment processing error:', e);
              alert('An error occurred during payment processing.');
            }
          }}
          onPaymentComplete={(data: any) => {
            try { fetch(`${API_URL}/printers/open-drawer`, { method: 'POST' }); } catch {}
            if (data?.change > 0 && data?.hasCashPayment && orderListPaymentOrder?.id) {
              try { fetch(`${API_URL}/payments/order/${orderListPaymentOrder.id}/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeAmount: data.change }) }); } catch {}
            }
            (async () => {
              try {
                const orderId = Number(orderListPaymentOrder?.id);
                if (!Number.isFinite(orderId)) return;
                await fetch(`${API_URL}/orders/${orderId}/close`, { method: 'POST' });
                window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId } }));
              } catch (e) {
                console.error('[Order History Pay] Failed to close order:', e);
              } finally {
                setShowOrderListPaymentModal(false);
                setOrderListPaymentOrder(null);
                setOrderListPaymentSessionPayments([]);
                try { await fetchOrderList(orderListDate); } catch {}
              }
            })();
          }}
          onComplete={() => {
            (async () => {
              try {
                const orderId = Number(orderListPaymentOrder?.id);
                if (!Number.isFinite(orderId)) return;
                await fetch(`${API_URL}/orders/${orderId}/close`, { method: 'POST' });
                window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId } }));
              } catch (e) {
                console.error('[Order History Pay] Failed to close order:', e);
              } finally {
                setShowOrderListPaymentModal(false);
                setOrderListPaymentOrder(null);
                setOrderListPaymentSessionPayments([]);
                try { await fetchOrderList(orderListDate); } catch {}
              }
            })();
          }}
        />
      </div>

      {/* Online/Togo Payment Complete Modal */}
      <PaymentCompleteModal
        isOpen={showOnlineTogoPaymentCompleteModal}
        onClose={handleOnlineTogoPaymentCompleteClose}
        mode="receiptOnly"
        onAddTips={(receiptCount: number) => {
          setOnlineTogoPendingReceiptCountForTip(receiptCount);
          setShowOnlineTogoPaymentCompleteModal(false);
          setShowOnlineTogoTipEntryModal(true);
        }}
        change={onlineTogoPaymentCompleteData?.change || 0}
        total={onlineTogoPaymentCompleteData?.total || 0}
        tip={onlineTogoPaymentCompleteData?.tip || 0}
        payments={onlineTogoPaymentCompleteData?.payments || []}
        hasCashPayment={onlineTogoPaymentCompleteData?.hasCashPayment || false}
        onAddCashTip={async (tipAmount: number) => {
          const orderId = onlineTogoCompletionRef.current?.orderId || onlineTogoSavedOrderIdRef.current;
          if (!orderId || tipAmount <= 0) return;
          try {
            const payRes = await fetch(`${API_URL}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId, method: 'CASH', amount: tipAmount, tip: tipAmount, guestNumber: null })
            });
            if (!payRes.ok) throw new Error('Failed to save cash tip');
            const payData = await payRes.json();
            setOnlineTogoSessionPayments(prev => ([...prev, { paymentId: payData.paymentId, method: 'CASH', amount: tipAmount, tip: tipAmount }]));
            console.log('Cash tip saved successfully');
          } catch (e) {
            console.error('Failed to save cash tip:', e);
          }
        }}
      />

      <TipEntryModal
        isOpen={showOnlineTogoTipEntryModal}
        onClose={() => {
          setShowOnlineTogoTipEntryModal(false);
          setShowOnlineTogoPaymentCompleteModal(true);
        }}
        onSave={async (tipAmount) => {
          const orderId = onlineTogoCompletionRef.current?.orderId || onlineTogoSavedOrderIdRef.current;
          if (!orderId || tipAmount <= 0) return;
          try {
            const payRes = await fetch(`${API_URL}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId, method: 'CASH', amount: tipAmount, tip: tipAmount, guestNumber: null })
            });
            if (!payRes.ok) throw new Error('Failed to save cash tip');
            const payData = await payRes.json();
            setOnlineTogoSessionPayments(prev => ([...prev, { paymentId: payData.paymentId, method: 'CASH', amount: tipAmount, tip: tipAmount }]));
          } catch (e) {
            console.error('Failed to save cash tip:', e);
          }
          setShowOnlineTogoTipEntryModal(false);
          await handleOnlineTogoPaymentCompleteClose(onlineTogoPendingReceiptCountForTip);
        }}
      />


      {/* UNPAID ì£¼ë¬¸ Pickup ì‹œë„ ì‹œ í™•ì¸ ëª¨ë‹¬ */}
      {showUnpaidPickupModal && unpaidPickupOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-6 py-4 text-center">
              <div className="text-2xl font-bold">Are you sure?</div>
              <div className="text-yellow-100 mt-1">
                Order #{unpaidPickupOrder.number || unpaidPickupOrder.id}
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 text-center">
              <div className="text-5xl mb-4">âš ï¸</div>
              <div className="text-lg text-gray-700 font-medium mb-2">
                This order has not been paid yet.
              </div>
              <div className="text-gray-500 mb-6">
                Please complete payment before pickup.
              </div>
              
              {/* Buttons */}
              <div className="space-y-3">
                {/* Payment - í° ë²„íŠ¼ */}
                <button
                  onClick={() => {
                    // UNPAID ëª¨ë‹¬ ë‹«ê¸°
                    setShowUnpaidPickupModal(false);
                    
                    // selectedOrderType ì„¤ì • (ê²°ì œ ì™„ë£Œ í›„ ì²˜ë¦¬ë¥¼ ìœ„í•´)
                    if (unpaidPickupOrder?.orderType) {
                      setSelectedOrderType(unpaidPickupOrder.orderType);
                    }
                    
                    // ê²°ì œ ëª¨ë‹¬ ì—´ê¸°
                    armPanelTogoPayKitchenSuppress();
                    setOnlineTogoPaymentOrder(unpaidPickupOrder);
                    setShowOnlineTogoPaymentModal(true);
                    
                    setUnpaidPickupOrder(null);
                  }}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
                >
                  Payment
                </button>
                
                {/* Back to List - ìž‘ì€ ë²„íŠ¼ */}
                <button
                  onClick={() => {
                    setShowUnpaidPickupModal(false);
                    setUnpaidPickupOrder(null);
                  }}
                  className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
                >
                  Back to List
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FSR Pickup Order Modal (TOGO 버튼 클릭 시) */}
      <PickupOrderModal
        isOpen={showFsrPickupModal}
        onClose={() => setShowFsrPickupModal(false)}
        initialMode={pickupModalInitialMode}
        onConfirm={(data: PickupOrderConfirmData) => {
          setShowFsrPickupModal(false);
          const readyTimeLabel = data.readyTimeLabel;
          const createdLocal = getLocalDatetimeString();
          const fm = data.fulfillmentMode;
          const newOrder: any = {
            id: Date.now(),
            type: fm === 'delivery' ? 'Delivery' : fm === 'online' ? 'Online' : 'Togo',
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            createdAt: createdLocal,
            phone: data.customerPhone,
            phoneRaw: (data.customerPhone || '').replace(/\D/g, ''),
            name: data.customerName,
            onlineOrderNumber: fm === 'online' ? String(data.onlineOrderNumber || '').trim() : undefined,
            firstName: '',
            lastName: '',
            nameOrder: 'western',
            status: 'pending',
            serverId: null,
            serverName: '',
            address: data.customerAddress,
            zip: data.customerZip,
            note: data.note,
            fulfillment: fm,
            pickup: { minutes: data.pickupMinutes, ampm: 'PM', dateLabel: '' },
            readyTimeLabel,
            virtualChannel: (fm === 'delivery' ? 'delivery' : fm === 'online' ? 'online' : 'togo') as VirtualOrderChannel,
            virtualTableId: null as string | null,
            service_pattern: 'TAKEOUT',
          };
          const usedVirtualIds = new Set<string>();
          Object.values(togoOrderMeta).forEach((meta) => {
            if (meta?.virtualTableId) usedVirtualIds.add(meta.virtualTableId);
          });
          const channel: VirtualOrderChannel = fm === 'delivery' ? 'delivery' : fm === 'online' ? 'online' : 'togo';
          const provisionalVirtualId = allocateVirtualTableId(channel, usedVirtualIds);
          newOrder.virtualTableId = provisionalVirtualId;
          setTogoOrderMeta((prev) => ({
            ...prev,
            [String(newOrder.id)]: { virtualTableId: provisionalVirtualId, channel },
          }));
          const seqLabel = fm === 'delivery' ? 'DELIVERY' : fm === 'online' ? 'ONLINE' : 'TOGO';
          setTogoOrders((prev) => assignDailySequenceNumbers([...prev, newOrder], seqLabel));
          navigate('/sales/order', {
            state: {
              orderType: fm,
              menuId: defaultMenu.menuId,
              menuName: defaultMenu.menuName,
              orderId: newOrder.id,
              serverId: null,
              serverName: '',
              customerName: data.customerName,
              customerPhone: data.customerPhone,
              customerAddress: data.customerAddress,
              customerZip: data.customerZip,
              customerNote: data.note,
              togoFulfillment: fm,
              pickup: newOrder.pickup,
              onlineOrderNumber: fm === 'online' ? String(data.onlineOrderNumber || '').trim() : undefined,
              isPrepaid: !!data.isPrepaid,
            },
          });
        }}
        onPayment={(order, orderType) => {
          try {
            const rawItems = (order.fullOrder?.items ?? order.items ?? []) as any[];
            const totals = pickOnlineTogoPaymentTotals(order, () => {
                  try {
                    const normalizedItems = (rawItems || []).map((it: any) => {
                      let discountObj: any = it.discount ?? null;
                      if (!discountObj && it.discount_json) {
                        try { discountObj = typeof it.discount_json === 'string' ? JSON.parse(it.discount_json) : it.discount_json; } catch { discountObj = null; }
                      }
                      return {
                        id: it.id ?? it.item_id ?? it.itemId ?? it.order_line_id ?? it.orderLineId ?? `${it.name || 'line'}`,
                        orderLineId: it.order_line_id ?? it.orderLineId,
                        name: it.name,
                        type: it.type,
                        quantity: it.quantity,
                        price: (typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0)),
                        totalPrice: (it.total_price ?? it.totalPrice),
                        modifiers: it.modifiers ?? it.options ?? [],
                        memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
                        discount: discountObj,
                        guestNumber: it.guestNumber ?? it.guest_number,
                        taxGroupId: it.taxGroupId ?? it.tax_group_id,
                        void_id: it.void_id,
                        voidId: it.voidId,
                        is_void: it.is_void,
                      };
                    });
                    const pricing = calculateOrderPricing(normalizedItems as any);
                    const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
                    const storedTotalRaw = Number((order.fullOrder?.total ?? order.total ?? pricing.totals.total ?? 0) as any);
                    const storedTotal = Number.isFinite(storedTotalRaw) ? Number(storedTotalRaw.toFixed(2)) : Number((pricing.totals.total || 0).toFixed(2));
                    const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
                    return { subtotal: netSubtotal, tax: derivedTax, taxLines: derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [], total: storedTotal };
                  } catch {
                    return { subtotal: 0, tax: 0, taxLines: [], total: 0 };
                  }
                });

            const orderForPayment = {
              id: order.id,
              type: orderType === 'online' ? 'Online' : 'Togo',
              orderType: orderType,
              number: (orderType === 'togo' || orderType === 'pickup')
                ? String(order.id).padStart(3, '0')
                : (order.number || order.id),
              time: order.time,
              phone: order.phone || order.customerPhone || '',
              name: order.name || order.customerName || '',
              total: Number((totals.total || 0).toFixed(2)),
              subtotal: Number((totals.subtotal || 0).toFixed(2)),
              tax: Number((totals.tax || 0).toFixed(2)),
              taxLines: Array.isArray(totals.taxLines) ? totals.taxLines : (Number(totals.tax || 0) ? [{ name: 'Tax', amount: Number((totals.tax || 0).toFixed(2)) }] : []),
              __togoTotals: totals,
              items: rawItems as any,
              localOrderId: order.localOrderId || order.fullOrder?.localOrderId || order.number,
              fullOrder: order.fullOrder,
              status: order.fullOrder?.status || order.status || 'pending',
            };
            setSelectedOrderType(orderType === 'delivery' ? 'delivery' : 'togo');
            armPanelTogoPayKitchenSuppress();
            setOnlineTogoPaymentOrder(orderForPayment);
            setShowFsrPickupModal(false);
            setShowOnlineTogoPaymentModal(true);
          } catch (err: any) { console.error('[FSR Pickup onPayment] ERROR:', err); alert('Payment open error: ' + (err?.message || err)); }
        }}
        onPickupComplete={async (order) => {
          const orderId: any = (order as any)?.order_id ?? order?.id;
          if (!orderId) return;
          try {
            await fetch(`${API_URL}/orders/${orderId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          } catch (e) { console.error('[FSR Pickup] Pickup complete error:', e); }
        }}
      />

      {/* Pickup List Modal (통합 Pickup/Togo/Delivery/Online 리스트) */}
      <PickupOrderModal
        isOpen={showPickupListModal}
        onClose={() => setShowPickupListModal(false)}
        initialMode="togo"
        initialTab="complete"
        onConfirm={() => setShowPickupListModal(false)}
        onPayment={(order, orderType) => {
          try {
            const rawItems = (order.fullOrder?.items ?? order.items ?? []) as any[];
            const totals = pickOnlineTogoPaymentTotals(order, () => {
                  try {
                    const normalizedItems = rawItems.map((it: any) => {
                      const discountObj = (() => {
                        const d = it.discount ?? it.discountData ?? null;
                        if (!d) return null;
                        if (typeof d === 'object') return d;
                        try { return JSON.parse(d); } catch { return null; }
                      })();
                      return {
                        ...it,
                        type: it.type || 'item',
                        quantity: it.quantity ?? 1,
                        price: (typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0)),
                        totalPrice: (it.total_price ?? it.totalPrice),
                        modifiers: it.modifiers ?? it.options ?? [],
                        memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
                        discount: discountObj,
                        guestNumber: it.guestNumber ?? it.guest_number,
                        taxGroupId: it.taxGroupId ?? it.tax_group_id,
                        void_id: it.void_id,
                        voidId: it.voidId,
                        is_void: it.is_void,
                      };
                    });
                    const pricing = calculateOrderPricing(normalizedItems as any);
                    const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
                    const storedTotalRaw = Number((order.fullOrder?.total ?? order.total ?? pricing.totals.total ?? 0) as any);
                    const storedTotal = Number.isFinite(storedTotalRaw) ? Number(storedTotalRaw.toFixed(2)) : Number((pricing.totals.total || 0).toFixed(2));
                    const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
                    return { subtotal: netSubtotal, tax: derivedTax, taxLines: derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [], total: storedTotal };
                  } catch {
                    return { subtotal: 0, tax: 0, taxLines: [], total: 0 };
                  }
                });
            const orderForPayment = {
              id: order.id,
              type: orderType === 'online' ? 'Online' : orderType === 'delivery' ? 'Delivery' : 'Togo',
              orderType: orderType,
              number: (orderType === 'togo' || orderType === 'pickup')
                ? String(order.id).padStart(3, '0')
                : (order.number || order.id),
              time: order.time,
              phone: order.phone || order.customerPhone || '',
              name: order.name || order.customerName || '',
              total: Number((totals.total || 0).toFixed(2)),
              subtotal: Number((totals.subtotal || 0).toFixed(2)),
              tax: Number((totals.tax || 0).toFixed(2)),
              taxLines: Array.isArray(totals.taxLines) ? totals.taxLines : (Number(totals.tax || 0) ? [{ name: 'Tax', amount: Number((totals.tax || 0).toFixed(2)) }] : []),
              __togoTotals: totals,
              items: rawItems as any,
              localOrderId: order.localOrderId || order.fullOrder?.localOrderId || order.number,
              fullOrder: order.fullOrder,
              status: order.fullOrder?.status || order.status || 'pending',
            };
            setSelectedOrderType(orderType === 'delivery' ? 'delivery' : 'togo');
            armPanelTogoPayKitchenSuppress();
            setOnlineTogoPaymentOrder(orderForPayment);
            setShowPickupListModal(false);
            setShowOnlineTogoPaymentModal(true);
          } catch (err: any) { console.error('[PickupList onPayment] ERROR:', err); alert('Payment open error: ' + (err?.message || err)); }
        }}
        onPickupComplete={async (order) => {
          const orderId: any = (order as any)?.order_id ?? order?.id;
          if (!orderId) return;
          try {
            await fetch(`${API_URL}/orders/${orderId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PICKED_UP' }),
            });
          } catch (e) { console.error('[PickupList] Pickup complete error:', e); }
        }}
      />

      {/* EXIT 모달 — PaymentModal PAY_NEO 톤 */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80]">
          <div
            className="w-[350px] max-w-[92vw] overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
            style={{ ...PAY_NEO.modalShell }}
          >
            <div className="rounded-[inherit] overflow-hidden" style={{ background: PAY_NEO_CANVAS }}>
              <div className="mx-4 mt-4 rounded-xl px-5 py-4 text-center" style={PAY_NEO.inset}>
                <div className="text-xl font-bold text-gray-800">Exit Menu</div>
                <div className="mt-1 text-sm text-gray-600">Select an option</div>
              </div>
              <div className="space-y-3 px-4 py-4">
                <button
                  type="button"
                  disabled={isWeb2posDemoBuild()}
                  onClick={() => {
                    setShowExitModal(false);
                    setBackofficePinError('');
                    setShowBackofficePinModal(true);
                  }}
                  className={`flex w-full items-center justify-center gap-3 rounded-xl py-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  Go to Back Office
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExitModal(false);
                    quitToOsFromPos();
                  }}
                  className={`flex w-full items-center justify-center gap-3 rounded-xl py-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT} touch-manipulation`}
                  style={PAY_NEO_PRIMARY_AMBER}
                >
                  <span className="text-2xl">🪟</span>
                  Go to Windows
                </button>
              </div>
              <div className="px-4 pb-5">
                <button
                  type="button"
                  onClick={() => setShowExitModal(false)}
                  className={`w-full rounded-xl py-3 text-sm font-semibold text-gray-800 ${NEO_PRESS_INSET_ONLY_NO_SHIFT} touch-manipulation`}
                  style={PAY_NEO_KEY_FLAT}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BackOffice PIN 확인 모달 */}
      <PinInputModal
        isOpen={showBackofficePinModal}
        onClose={() => {
          setShowBackofficePinModal(false);
          setBackofficePinError('');
        }}
        onSubmit={async (pin: string) => {
          if (pin === '0000') {
            setBackofficePinError('0000 cannot be used');
            return;
          }
          setBackofficePinLoading(true);
          setBackofficePinError('');
          try {
            if (isMasterPosPin(pin)) {
              setShowBackofficePinModal(false);
              setBackofficePinError('');
              navigate('/backoffice');
              return;
            }
            const res = await fetch(`${API_URL}/admin-settings/verify-backoffice-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin })
            });
            const data = await res.json();
            if (data.success) {
              setShowBackofficePinModal(false);
              setBackofficePinError('');
              navigate('/backoffice');
            } else {
              setBackofficePinError('Invalid PIN. Please try again.');
            }
          } catch (e) {
            setBackofficePinError('Verification failed. Please try again.');
          } finally {
            setBackofficePinLoading(false);
          }
        }}
        title="Back Office PIN"
        message="Enter PIN to access Back Office"
        isLoading={backofficePinLoading}
        error={backofficePinError}
      />

      {/* Order Detail Modal (Online/Togo ì¹´ë“œ í´ë¦­ ì‹œ) - ê³µìš© ì»´í¬ë„ŒíŠ¸ ì‚¬ìš© */}
      <OrderDetailModal
        isOpen={showOrderDetailModal}
        onClose={() => {
          setShowOrderDetailModal(false);
          setSelectedOrderDetail(null);
          setSelectedOrderType(null);
        }}
        splitPayAndPickupActions
        splitPayAndPickupOnlineOnly
        onBackToOrder={handleBackToOrderFromDetailModal}
        onlineOrders={onlineQueueCards as OrderData[]}
        togoOrders={togoOrders.filter(o => String(o.fulfillment || '').toLowerCase() !== 'delivery' && String(o.type || '').toLowerCase() !== 'delivery' && !o.deliveryCompany && String(o.fulfillment || '').toLowerCase() !== 'online' && String(o.type || '').toLowerCase() !== 'online') as OrderData[]}
        deliveryOrders={togoOrders.filter(o => String(o.fulfillment || '').toLowerCase() === 'delivery' || String(o.type || '').toLowerCase() === 'delivery' || o.deliveryCompany) as OrderData[]}
        initialOrderType={(selectedOrderType as OrderChannelType) || 'togo'}
        initialSelectedOrder={selectedOrderDetail as OrderData}
        onPayment={(order, orderType) => {
          void (async () => {
            try {
              let working: any = { ...order };
              const sqliteHint =
                working.localOrderId ??
                working.fullOrder?.localOrderId ??
                working.fullOrder?.order_id ??
                working.order_id ??
                null;
              const oid = Number(sqliteHint);
              if (Number.isFinite(oid) && oid > 0) {
                try {
                  const res = await fetch(`${API_URL}/orders/${oid}`);
                  if (res.ok) {
                    const data = await res.json();
                    if (data.success && Array.isArray(data.items) && data.items.length > 0) {
                      const foPrev = working.fullOrder || {};
                      const ord = data.order || {};
                      working = {
                        ...working,
                        fullOrder: {
                          ...foPrev,
                          items: data.items,
                          subtotal: ord.subtotal ?? foPrev.subtotal,
                          tax: ord.tax ?? foPrev.tax,
                          total: ord.total ?? foPrev.total,
                          localOrderId: ord.id ?? oid,
                        },
                        subtotal: ord.subtotal ?? working.subtotal,
                        tax: ord.tax ?? working.tax,
                        total: ord.total ?? working.total,
                      };
                    }
                  }
                } catch {}
              }

              const rawItems = (working.fullOrder?.items ?? working.items ?? []) as any[];
              const totals = pickOnlineTogoPaymentTotals(working, () => {
                try {
                  const normalizedItems = (rawItems || []).map((it: any) => {
                    let discountObj: any = it.discount ?? null;
                    if (!discountObj && it.discount_json) {
                      try { discountObj = typeof it.discount_json === 'string' ? JSON.parse(it.discount_json) : it.discount_json; } catch { discountObj = null; }
                    }
                    return {
                      id: it.id ?? it.item_id ?? it.itemId ?? it.order_line_id ?? it.orderLineId ?? `${it.name || 'line'}`,
                      orderLineId: it.order_line_id ?? it.orderLineId,
                      name: it.name,
                      type: it.type,
                      quantity: it.quantity,
                      price: (typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0)),
                      totalPrice: (it.total_price ?? it.totalPrice),
                      modifiers: it.modifiers ?? it.options ?? [],
                      memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
                      discount: discountObj,
                      guestNumber: it.guestNumber ?? it.guest_number,
                      taxGroupId: it.taxGroupId ?? it.tax_group_id,
                      void_id: it.void_id,
                      voidId: it.voidId,
                      is_void: it.is_void,
                    };
                  });
                  const pricing = calculateOrderPricing(normalizedItems as any);
                  const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
                  const storedTotalRaw = Number(
                    (working.fullOrder?.total ?? working.total ?? pricing.totals.total ?? 0) as any
                  );
                  const storedTotal = Number.isFinite(storedTotalRaw)
                    ? Number(storedTotalRaw.toFixed(2))
                    : Number((pricing.totals.total || 0).toFixed(2));
                  const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
                  return {
                    subtotal: netSubtotal,
                    tax: derivedTax,
                    taxLines: derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [],
                    total: storedTotal,
                  };
                } catch {
                  return { subtotal: 0, tax: 0, taxLines: [], total: 0 };
                }
              });

              const payTotal = Number((Number(totals.total) || 0).toFixed(2));
              const paySub = Number((Number(totals.subtotal) || 0).toFixed(2));
              const payTax = Number((Number(totals.tax) || 0).toFixed(2));
              const payTaxLines = Array.isArray(totals.taxLines)
                ? totals.taxLines
                : payTax > 0
                  ? [{ name: 'Tax', amount: Number(payTax.toFixed(2)) }]
                  : [];

              const orderForPayment = {
                id: working.id,
                type: orderType === 'online' ? 'Online' : orderType === 'delivery' ? 'Delivery' : 'Togo',
                orderType: orderType,
                number:
                  orderType === 'togo' || orderType === 'pickup'
                    ? String(working.id).padStart(3, '0')
                    : working.number || working.id,
                time: working.time,
                phone: working.phone || working.customerPhone || '',
                name: working.name || working.customerName || '',
                total: payTotal,
                subtotal: paySub,
                tax: payTax,
                taxLines: payTaxLines,
                __togoTotals: { ...totals, total: payTotal, subtotal: paySub, tax: payTax, taxLines: payTaxLines },
                items: rawItems as any,
                localOrderId: working.localOrderId || working.fullOrder?.localOrderId || working.number,
                fullOrder: working.fullOrder,
                status: working.fullOrder?.status || working.status || 'pending',
                __completePickupAfterPay: !!(working as any).__completePickupAfterPay,
              };

              flushSync(() => {
                setOnlineTogoPaymentOrder(orderForPayment);
              });
              armPanelTogoPayKitchenSuppress();
              setShowOrderDetailModal(false);
              setShowOnlineTogoPaymentModal(true);
            } catch (err: any) {
              console.error('❌ [onPayment] ERROR:', err);
              alert('Payment open error: ' + (err?.message || err));
            }
          })();
        }}
        onPickupComplete={async (order, orderType) => {
          const orderId = order.id;
          const localOrderId = order.localOrderId || order.fullOrder?.localOrderId || order.number;
          
          if (orderId) {
            try {
              if (orderType === 'online') {
                await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
                if (localOrderId && typeof localOrderId === 'number') {
                  await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'PICKED_UP' }),
                  });
                }
                setOnlineQueueCards(prev => prev.filter(card => String(card.id) !== String(orderId)));
              } else if (orderType === 'togo' || orderType === 'pickup') {
                await fetch(`${API_URL}/orders/${orderId}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'PICKED_UP' }),
                });
                setTogoOrders(prev => prev.filter(o => String(o.id) !== String(orderId)));
              } else if (orderType === 'delivery') {
                const actualOrderId = order.order_id || orderId;
                // If this delivery is not yet saved into orders table (meta-only), skip orders status update.
                if (Number.isFinite(Number(actualOrderId))) {
                  await fetch(`${API_URL}/orders/${actualOrderId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'PICKED_UP' }),
                  });
                }
                // Delivery 목록은 delivery_orders 메타 테이블에서도 만들어지므로,
                // 메타 상태도 함께 PICKED_UP 처리하지 않으면 모달에서 다시 나타날 수 있음.
                const deliveryMetaId = (order as any).deliveryMetaId || (order as any).delivery_meta_id || null;
                try {
                  if (deliveryMetaId != null && String(deliveryMetaId).trim() !== '') {
                    await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(String(deliveryMetaId))}/status`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'PICKED_UP' }),
                    });
                  }
                } catch {}
                setTogoOrders(prev =>
                  prev.filter(o => String(o.id) !== String(orderId) && String((o as any).deliveryMetaId || '') !== String(deliveryMetaId || ''))
                );
              }
            } catch (error) {
              console.error('Pickup complete error:', error);
            }
          }
          setShowOrderDetailModal(false);
          setSelectedOrderDetail(null);
          setSelectedOrderType(null);
          loadOnlineOrders();
          loadTogoOrders();
        }}
        onVoid={async (order, orderType) => {
          const sqliteOrderId = resolveSqliteOrderIdForVoid(order, orderType);
          if (sqliteOrderId == null || sqliteOrderId === '') {
            alert('Order not found (missing local order id).');
            return;
          }
          try {
            let items: any[] = [];
            const fullOrder = order.fullOrder;
            if (fullOrder?.items && Array.isArray(fullOrder.items)) {
              items = fullOrder.items;
            } else {
              const res = await fetch(`${API_URL}/orders/${sqliteOrderId}`);
              if (res.ok) {
                const data = await res.json();
                items = (data.items || []).map((it: any) => {
                  let mods: any[] = [];
                  try { if (it.modifiers_json) mods = typeof it.modifiers_json === 'string' ? JSON.parse(it.modifiers_json) : it.modifiers_json; } catch {}
                  return { ...it, modifiers: mods };
                });
              }
            }
            const sels: Record<string, { checked: boolean; qty: number }> = {};
            items.forEach((it: any) => {
              const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id);
              sels[key] = { checked: true, qty: it.quantity || 1 };
            });
            const orderForModal =
              String(orderType).toLowerCase() === 'online'
                ? { ...order, id: sqliteOrderId, localOrderId: order.localOrderId ?? sqliteOrderId }
                : order;
            setTogoVoidOrder(orderForModal);
            setTogoVoidOrderType(orderType);
            setTogoVoidItems(items);
            setTogoVoidSelections(sels);
            setTogoVoidPin('');
            setTogoVoidPinError('');
            setTogoVoidReason('');
            setTogoVoidReasonPreset('');
            setTogoVoidNote('');
            setTogoVoidLoading(false);
            setShowTogoVoidModal(true);
          } catch (e) {
            console.error('Failed to load items for void:', e);
            alert('Failed to load order items.');
          }
        }}
        onOrdersRefresh={() => {
          loadOnlineOrders();
          loadTogoOrders();
        }}
      />

      {/* Togo/Online Void Modal (Dine-in style) */}
      {showTogoVoidModal && (() => {
        const selectedItems = Object.entries(togoVoidSelections).filter(([, v]) => v.checked);
        const selCount = selectedItems.reduce((s, [, v]) => s + v.qty, 0);
        const selSubtotal = selectedItems.reduce((s, [k, v]) => {
          const item = togoVoidItems.find((it: any) => String(it.order_line_id || it.orderLineId || it.item_id || it.id) === k);
          return s + (item ? (item.price || 0) * v.qty : 0);
        }, 0);
        const resolvedVoidOrderId = resolveSqliteOrderIdForVoid(togoVoidOrder, togoVoidOrderType);
        const isShellEntireVoid = !(togoVoidItems || []).length;
        const canConfirm =
          (selCount > 0 || isShellEntireVoid) &&
          togoVoidPin.length >= 4 &&
          !togoVoidLoading &&
          resolvedVoidOrderId != null &&
          String(resolvedVoidOrderId) !== '';
        const orderId = resolvedVoidOrderId;
        const orderLabel = togoVoidOrderType === 'delivery'
          ? `${togoVoidOrder?.deliveryCompany || 'Delivery'} #${togoVoidOrder?.deliveryOrderNumber || orderId}`
          : `#${(togoVoidOrderType === 'togo' || togoVoidOrderType === 'pickup') ? String(orderId).padStart(3, '0') : (togoVoidOrder?.number || orderId)}`;

        /** 항목 미선택: 비활성 Void를 오목(inset) 대신 볼록(raised)으로 표시 */
        const voidCtaDisabledStyle: React.CSSProperties =
          selCount === 0 && !isShellEntireVoid
            ? { ...PAY_NEO.raised, color: '#94a3b8' }
            : { ...PAY_NEO.inset, color: '#94a3b8' };

        const handleConfirmTogoVoid = async () => {
          if (!canConfirm) return;
          setTogoVoidLoading(true);
          setTogoVoidPinError('');
          try {
            const shellVoid = !(togoVoidItems || []).length;
            const lines = shellVoid
              ? []
              : selectedItems.map(([k, v]) => {
              const item = togoVoidItems.find((it: any) => String(it.order_line_id || it.orderLineId || it.item_id || it.id) === k);
              return {
                order_line_id: item?.order_line_id || item?.orderLineId || null,
                menu_id: item?.item_id || item?.id || null,
                name: item?.name || '',
                qty: v.qty,
                amount: (item?.price || 0) * v.qty,
                tax: (item?.tax || 0) * (v.qty / (item?.quantity || 1)),
                printer_group_id: item?.printer_group_id || null,
              };
            });
            const isEntire =
              shellVoid ||
              (selectedItems.length === togoVoidItems.length && selectedItems.every(([k, v]) => {
              const item = togoVoidItems.find((it: any) => String(it.order_line_id || it.orderLineId || it.item_id || it.id) === k);
              return v.qty >= (item?.quantity || 1);
            }));
            const res = await fetch(`${API_URL}/orders/${orderId}/void`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lines,
                reason: togoVoidReason || togoVoidReasonPreset || '',
                note: togoVoidNote,
                source: isEntire ? 'entire' : 'partial',
                manager_pin: togoVoidPin,
              }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Void failed' }));
              setTogoVoidPinError(err.error || 'Void failed');
              setTogoVoidLoading(false);
              return;
            }

            const vo: any = togoVoidOrder;
            const dm =
              vo?.deliveryMetaId ??
              vo?.delivery_meta_id ??
              (typeof vo?.table_id === 'string' && String(vo.table_id).toUpperCase().startsWith('DL')
                ? String(vo.table_id).substring(2)
                : null);
            const fbDoc =
              vo?.fullOrder?.id != null && String(vo.fullOrder.id).trim() !== ''
                ? String(vo.fullOrder.id).trim()
                : '';
            const sqliteStr = orderId != null && String(orderId).trim() !== '' ? String(orderId).trim() : '';
            const voidTypeLc = String(togoVoidOrderType || '').toLowerCase();
            // SQLite void만으로는 패널에 남는 경우: Firestore 온라인 행 + delivery_orders 메타
            if (fbDoc && (voidTypeLc === 'online' || fbDoc !== sqliteStr)) {
              try {
                await fetch(`${API_URL}/online-orders/order/${encodeURIComponent(fbDoc)}/cancel`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
              } catch (e) {
                console.warn('[Void] Firebase online cancel failed:', e);
              }
            }
            if (dm != null && String(dm).trim() !== '') {
              try {
                await fetch(`${API_URL}/orders/delivery-orders/${encodeURIComponent(String(dm).trim())}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'CANCELLED' }),
                });
              } catch (e) {
                console.warn('[Void] delivery_orders CANCELLED patch failed:', e);
              }
            }
            registerSwipeRemovedPanelIds(
              vo?.id,
              fbDoc,
              sqliteStr,
              vo?.localOrderId,
              vo?.fullOrder?.localOrderId,
              vo?.order_id,
              vo?.onlineOrderNumber,
              vo?.fullOrder?.onlineOrderNumber,
              vo?.fullOrder?.externalOrderNumber,
              dm
            );

            setTogoVoidLoading(false);
            setShowTogoVoidModal(false);
            setShowCardDetailModal(false);
            setShowOrderDetailModal(false);
            setSelectedOrderDetail(null);
            setSelectedOrderType(null);
            loadOnlineOrders();
            loadTogoOrders();
            window.setTimeout(() => {
              loadOnlineOrders();
              loadTogoOrders();
            }, 600);
            if (showOrderListModal) {
              setOrderListSelectedOrder(null);
              setOrderListSelectedItems([]);
              fetchOrderList(orderListDate, orderListOpenMode);
            }
          } catch (e) {
            console.error('Void error:', e);
            setTogoVoidPinError('An error occurred.');
            setTogoVoidLoading(false);
          }
        };

        return (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black bg-opacity-50"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowTogoVoidModal(false);
              if (e.key === 'Enter' && canConfirm) { e.preventDefault(); handleConfirmTogoVoid(); }
            }}
          >
            <div
              className="w-full max-w-[820px] max-h-[90vh] overflow-y-auto p-3"
              onClick={(e) => e.stopPropagation()}
              style={{ ...PAY_NEO.modalShell }}
            >
              <div className="flex flex-col rounded-[inherit] p-4" style={{ background: PAY_NEO_CANVAS }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-lg font-bold text-gray-800">Void Items — {orderLabel}</div>
                  <button
                    type="button"
                    aria-label="Close"
                    className={`text-3xl font-bold w-11 h-11 flex items-center justify-center rounded-full text-gray-600 ${VOID_MODAL_KEY_PRESS}`}
                    style={MODAL_CLOSE_X_KEY}
                    onClick={() => setShowTogoVoidModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="w-full lg:max-w-[400px] lg:flex-none space-y-3">
                    <div className="space-y-0 px-3 py-4" style={PAY_NEO.inset}>
                      {isShellEntireVoid && (
                        <div className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          No line items on this order. Void still removes it from the board (entire order, $0.00).
                        </div>
                      )}
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-400/40">
                        <div className="text-sm font-bold text-gray-800">Select Items</div>
                        <label className="text-sm flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" onChange={e => {
                            const checked = e.target.checked;
                            setTogoVoidSelections(prev => {
                              const next = { ...prev };
                              togoVoidItems.forEach((it: any) => {
                                const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id);
                                next[key] = { checked, qty: next[key]?.qty ?? (it.quantity || 1) };
                              });
                              return next;
                            });
                          }} />
                          <span className="font-medium text-gray-800">Select All</span>
                        </label>
                      </div>
                      {togoVoidItems.map((it: any) => {
                        const key = String(it.order_line_id || it.orderLineId || it.item_id || it.id);
                        const sel = togoVoidSelections[key] || { checked: false, qty: it.quantity || 1 };
                        const maxQty = it.quantity || 1;
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-2 py-2 px-2 mb-2 last:mb-0"
                            style={sel.checked ? PAY_NEO.inset : PAY_NEO.raised}
                          >
                            <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" checked={!!sel.checked} onChange={e => setTogoVoidSelections(prev => ({ ...prev, [key]: { ...prev[key], checked: e.target.checked } }))} />
                            <div className="flex-1 truncate text-sm font-medium text-gray-800">{it.name}</div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                className={`w-11 h-11 flex items-center justify-center rounded-lg text-gray-800 font-bold text-2xl disabled:opacity-30 ${VOID_MODAL_KEY_PRESS}`}
                                style={PAY_NEO.key}
                                onClick={() => setTogoVoidSelections(prev => ({ ...prev, [key]: { qty: Math.max(1, sel.qty - 1), checked: true } }))}
                                disabled={sel.qty <= 1}
                              >
                                −
                              </button>
                              <span className="w-9 text-center text-base font-bold text-gray-900">{sel.qty}</span>
                              <button
                                type="button"
                                className={`w-11 h-11 flex items-center justify-center rounded-lg text-gray-800 font-bold text-2xl disabled:opacity-30 ${VOID_MODAL_KEY_PRESS}`}
                                style={PAY_NEO.key}
                                onClick={() => setTogoVoidSelections(prev => ({ ...prev, [key]: { qty: Math.min(maxQty, sel.qty + 1), checked: true } }))}
                                disabled={sel.qty >= maxQty}
                              >
                                +
                              </button>
                              <span className="text-xs text-gray-600 ml-0.5 w-7">/ {maxQty}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-semibold text-gray-800 block mb-1">Reason</label>
                        <select
                          className="w-full px-3 py-2.5 text-sm text-gray-800 outline-none"
                          style={PAY_NEO.inset}
                          value={togoVoidReasonPreset}
                          onChange={e => { setTogoVoidReasonPreset(e.target.value); if (e.target.value !== 'Other') setTogoVoidReason(e.target.value); }}
                        >
                          <option value="">Select a reason</option>
                          <option>Customer Cancel</option>
                          <option>Wrong Item</option>
                          <option>Kitchen Error</option>
                          <option>Overcharge</option>
                          <option>Other</option>
                        </select>
                        {togoVoidReasonPreset === 'Other' && (
                          <input
                            className="mt-1.5 w-full px-3 py-2.5 text-sm text-gray-800 outline-none"
                            style={PAY_NEO.inset}
                            value={togoVoidReason}
                            onChange={e => setTogoVoidReason(e.target.value)}
                            placeholder="Enter reason"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-gray-800 block mb-1">Note</label>
                        <input
                          className="w-full px-3 py-2.5 text-sm text-gray-800 outline-none"
                          style={PAY_NEO.inset}
                          value={togoVoidNote}
                          onChange={e => setTogoVoidNote(e.target.value)}
                          placeholder="Note (optional)"
                        />
                      </div>
                    </div>
                    <div className="text-sm font-bold text-gray-800 px-3 py-2.5 text-center" style={PAY_NEO.raised}>
                      Selected: {selCount} • Subtotal: ${selSubtotal.toFixed(2)}
                    </div>
                  </div>
                  <div className="w-full lg:w-[280px] flex-shrink-0">
                    <div className="p-4 h-full" style={PAY_NEO.raised}>
                      <p className="text-sm font-semibold text-gray-800 mb-2">Void Authorization PIN</p>
                      <div className="flex flex-col gap-3 items-start w-full">
                        <input
                          className={`w-full rounded-lg px-3 py-2.5 text-sm font-medium text-gray-900 outline-none ${togoVoidPinError ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-[#e0e5ec]' : ''}`}
                          style={PAY_NEO.inset}
                          placeholder="Authorization PIN"
                          value={togoVoidPin}
                          onChange={e => { setTogoVoidPinError(''); setTogoVoidPin(e.target.value.replace(/[^0-9]/g, '')); }}
                          inputMode="numeric"
                          maxLength={4}
                        />
                        {togoVoidPinError && <span className="text-xs text-red-600 font-medium">{togoVoidPinError}</span>}
                        <div className="grid grid-cols-3 gap-2 w-full">
                          {[1,2,3,4,5,6,7,8,9].map(num => (
                            <button
                              key={num}
                              type="button"
                              className={`h-12 rounded-lg font-semibold text-gray-800 ${VOID_MODAL_KEY_PRESS}`}
                              style={PAY_KEYPAD_KEY}
                              onClick={() => { if (togoVoidPin.length < 4) setTogoVoidPin(prev => prev + num); setTogoVoidPinError(''); }}
                            >
                              {num}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`h-12 rounded-lg font-semibold text-gray-800 ${VOID_MODAL_KEY_PRESS}`}
                            style={PAY_KEYPAD_KEY}
                            onClick={() => { setTogoVoidPin(''); setTogoVoidPinError(''); }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className={`h-12 rounded-lg font-semibold text-gray-800 ${VOID_MODAL_KEY_PRESS}`}
                            style={PAY_KEYPAD_KEY}
                            onClick={() => { if (togoVoidPin.length < 4) setTogoVoidPin(prev => prev + '0'); setTogoVoidPinError(''); }}
                          >
                            0
                          </button>
                          <button
                            type="button"
                            className={`h-12 rounded-lg font-semibold text-gray-800 ${VOID_MODAL_KEY_PRESS}`}
                            style={PAY_KEYPAD_KEY}
                            onClick={() => { setTogoVoidPin(prev => prev.slice(0, -1)); setTogoVoidPinError(''); }}
                          >
                            ←
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    className={`px-5 py-2.5 rounded-lg text-sm font-bold min-w-[110px] text-gray-800 ${VOID_MODAL_KEY_PRESS}`}
                    style={PAY_NEO.key}
                    onClick={() => setShowTogoVoidModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`px-5 py-2.5 rounded-lg text-sm font-bold min-w-[110px] text-white disabled:opacity-50 ${VOID_MODAL_PRIMARY_PRESS}`}
                    style={canConfirm ? VOID_MODAL_NEO_RED : voidCtaDisabledStyle}
                    disabled={!canConfirm}
                    onClick={handleConfirmTogoVoid}
                  >
                    Void
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {showReservedActionModal && (() => {
        const m = showReservedActionModal;
        const handleCancelReservation = async () => {
          try {
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(m.tableId)}/status`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'Available' })
            });
            setTableReservationNames(prev => { const n = { ...prev }; delete n[m.tableId]; try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(n)); } catch {} return n; });
            setTableReservationDetails(prev => { const n = { ...prev }; delete n[m.tableId]; try { localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(n)); } catch {} return n; });
            setTableHoldInfo(prev => { const n = { ...prev }; delete n[m.tableId]; return n; });
            fetchTableMapData();
          } catch {}
          setShowReservedActionModal(null);
        };
        const handleSeatGuest = async () => {
          const el = tableElements.find((e: any) => String(e.id) === m.tableId);
          setTableReservationNames(prev => { const n = { ...prev }; delete n[m.tableId]; try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(n)); } catch {} return n; });
          setTableReservationDetails(prev => { const n = { ...prev }; delete n[m.tableId]; try { localStorage.setItem(`reservationDetails_${selectedFloor}`, JSON.stringify(n)); } catch {} return n; });
          setTableHoldInfo(prev => { const n = { ...prev }; delete n[m.tableId]; return n; });
          if (el && defaultMenu) {
            navigate('/sales/order', {
              state: {
                orderType: 'POS', menuId: defaultMenu.menuId, menuName: defaultMenu.menuName,
                tableId: el.id, tableLabel: el.text, tableName: el.text,
                floor: selectedFloor, loadExisting: false
              }
            });
          }
          setShowReservedActionModal(null);
        };
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowReservedActionModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 min-w-[320px] max-w-[400px]" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-5">
                <div className="text-lg font-bold text-gray-800">{m.tableName}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {m.customerName && <span className="font-semibold">{m.customerName}</span>}
                  {m.reservationTime && <span className="ml-2">{m.reservationTime}</span>}
                </div>
                {m.isHoldOrigin && <div className="mt-1 text-xs text-red-500 font-semibold">Auto-Hold Applied</div>}
              </div>
              <div className="flex flex-col gap-3">
                <button
                  className="w-full py-3.5 rounded-xl text-white font-bold text-base transition-all"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}
                  onClick={handleSeatGuest}
                >
                  Seat Guest
                </button>
                <button
                  className="w-full py-3.5 rounded-xl text-white font-bold text-base transition-all"
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }}
                  onClick={handleCancelReservation}
                >
                  Cancel Reservation
                </button>
                <button
                  className="w-full py-2.5 rounded-xl text-gray-500 font-semibold text-sm bg-gray-100 hover:bg-gray-200 transition-all"
                  onClick={() => setShowReservedActionModal(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ReservationCreateModal
        open={showReservationModal}
        onClose={() => setShowReservationModal(false)}
        onCreated={() => {
          setShowReservationModal(false);
          void loadTodayReservations();
        }}
        onTableStatusChanged={handleGuestFlowTableStatusChanged}
      />
      {softKbOpen && (
        <VirtualKeyboard
          open={softKbOpen}
          title={''}
          bottomOffsetPx={0}
          zIndex={2147483646}
          languages={['EN']}
          currentLanguage={kbLang}
          onToggleLanguage={(next)=>setKbLang(next)}
          displayText={togoSearch}
          onRequestClose={() => setSoftKbOpen(false)}
          onType={(k)=> setTogoSearch(prev=>`${prev||''}${k}`)}
          onBackspace={()=> setTogoSearch(prev=> prev ? prev.slice(0,-1) : '')}
          onClear={()=> setTogoSearch('')}
        />
      )}
      
      {/* Day Opening Modal */}
      {showOpeningModal && !requiresOpening && (
        <div className="fixed inset-0 z-[999999] pointer-events-none flex items-center justify-center">
          <div className="relative pointer-events-none flex flex-col items-center" style={{ width: '500px', height: '600px' }}>
             {/* Position container */}
             <div className="w-full relative h-[60px] pointer-events-none flex justify-end">
              <button
                onClick={() => setShowOpeningModal(false)}
                className="absolute right-0 top-0 w-12 h-12 border-2 border-red-500 bg-white/30 hover:bg-red-50/50 rounded-full flex items-center justify-center transition-colors z-[9999999] shadow-lg pointer-events-auto"
                style={{ transform: 'translate(20px, -20px)' }}
              >
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      <DayOpeningModal 
        isOpen={showOpeningModal} 
        onClose={() => {
          if (!requiresOpening) {
            setShowOpeningModal(false);
          }
        }} 
        onOpeningComplete={(data) => {
          setShowOpeningModal(false);
          setIsDayClosed(false);
          setRequiresOpening(false);
        }} 
      />

      {/* Day Closed Overlay */}
      {isDayClosed && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-70">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
            <div className="text-6xl mb-4"></div>
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Day is Closed</h2>
            <p className="text-gray-600 mb-8">
              Today's business has been closed. <br/>
              To start taking orders, please re-open the day.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setIsDayClosed(false);
                  setShowOpeningModal(true);
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xl rounded-xl shadow-lg transition-all"
              >
                🔄 Re-Open Day
              </button>
              <button 
                onClick={() => {
                  setIsDayClosed(false);
                  setShowOpeningModal(true);
                }}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day Closing Modal */}
      <DayClosingModal
        isOpen={showClosingModal}
        onClose={() => setShowClosingModal(false)}
        onClosingComplete={() => setIsDayClosed(true)}
      />

      {/* Clock In/Out Menu Modal */}
      {showClockInOutMenu && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50">
          <div className="w-96 max-w-[92vw] overflow-hidden relative" style={PAY_NEO.modalShell}>
            <button
              type="button"
              onClick={() => setShowClockInOutMenu(false)}
              className={`absolute right-3 top-3 z-10 flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl border-[3px] border-red-500 transition-all hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
              style={{ ...PAY_NEO.raised }}
              aria-label="Close"
              title="Close"
            >
              <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="px-5 py-4 pr-16" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
              <h2 className="text-xl font-extrabold text-slate-800 text-center">⏰ Clock In/Out</h2>
            </div>
            <div className="px-5 pb-5 pt-2 space-y-3" style={{ background: PAY_NEO_CANVAS }}>
              <button
                type="button"
                onClick={() => {
                  console.log('Clock In ë©”ë‰´ì—ì„œ ì„ íƒë¨');
                  setShowClockInOutMenu(false);
                  setShowClockInModal(true);
                }}
                className={`w-full px-6 py-4 font-bold text-white text-lg rounded-[14px] hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                style={{ ...OH_ACTION_NEO.green, borderRadius: 14 }}
              >
                ⏰ Clock In
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log('Clock Out ë©”ë‰´ì—ì„œ ì„ íƒë¨');
                  setShowClockInOutMenu(false);
                  setShowClockOutModal(true);
                }}
                className={`w-full px-6 py-4 font-bold text-white text-lg rounded-[14px] hover:brightness-[1.02] touch-manipulation ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                style={{ ...OH_ACTION_NEO.red, borderRadius: 14 }}
              >
                🚪 Clock Out
              </button>
              <button
                type="button"
                onClick={() => setShowClockInOutMenu(false)}
                className="w-full px-4 py-3 rounded-[14px] font-bold text-gray-700 transition-all hover:brightness-[1.02] active:brightness-95"
                style={PAY_NEO.inset}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clock In PIN Modal */}
      <PinInputModal
        isOpen={showClockInModal}
        onClose={() => {
          setShowClockInModal(false);
          setClockError('');
        }}
        onSubmit={async (pin: string) => {
          setIsClockLoading(true);
          setClockError('');

          try {
            const { employee } = await clockInOutApi.verifyPin(pin);
            await clockInOutApi.clockIn(employee.id, employee.name, pin);
            setShowClockInModal(false);
          } catch (error: any) {
            setClockError(error.message || 'Clock in failed');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="Clock In"
        message="Enter your PIN"
        isLoading={isClockLoading}
        error={clockError}
      />

      {/* Clock Out PIN Modal */}
      <PinInputModal
        isOpen={showClockOutModal}
        onClose={() => {
          setShowClockOutModal(false);
          setClockError('');
        }}
        onSubmit={async (pin: string) => {
          setIsClockLoading(true);
          setClockError('');

          try {
            const { employee } = await clockInOutApi.verifyPin(pin);

            const now = new Date();
            const currentHour = now.getHours();
            
            if (currentHour < 18) {
              setSelectedEmployee(employee);
              setShowClockOutModal(false);
              setShowEarlyOutModal(true);
              setIsClockLoading(false);
              return;
            }

            const response = await clockInOutApi.clockOut(employee.id, pin);
            
            alert(`${employee.name}, you have clocked out!\nTotal hours: ${response.totalHours} hours`);
            
            setShowClockOutModal(false);
          } catch (error: any) {
            setClockError(error.message || 'Clock out failed');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="Clock Out"
        message="Enter your PIN"
        isLoading={isClockLoading}
        error={clockError}
      />

      {/* Early Out Modal */}
      {showEarlyOutModal && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50">
          <div className="w-96 max-w-[92vw] overflow-hidden" style={PAY_NEO.modalShell}>
            <div className="px-5 py-4" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
              <h2 className="text-xl font-extrabold text-slate-800">⚠️ Early Out</h2>
            </div>
            <div className="px-5 pb-5 pt-2" style={{ background: PAY_NEO_CANVAS }}>
              <p className="text-slate-600 mb-4 text-sm font-medium">
                Please enter the reason for {selectedEmployee?.name}&apos;s early out.
              </p>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Early Out Reason *
                </label>
                <textarea
                  value={earlyOutReason}
                  onChange={(e) => setEarlyOutReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-[14px] focus:outline-none focus:ring-2 focus:ring-blue-400/60 border-0"
                  style={PAY_NEO.inset}
                  rows={3}
                  placeholder="ì˜ˆ: ê°œì¸ ì‚¬ì •, ë³‘ì› ë°©ë¬¸ ë“±"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  ìŠ¹ì¸ìž (ì„ íƒ)
                </label>
                <input
                  type="text"
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="w-full px-3 py-2 rounded-[14px] focus:outline-none focus:ring-2 focus:ring-blue-400/60 border-0"
                  style={PAY_NEO.inset}
                  placeholder="ìŠ¹ì¸ìž ì´ë¦„"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEarlyOutModal(false);
                    setSelectedEmployee(null);
                    setEarlyOutReason('');
                    setApprovedBy('');
                  }}
                  className={`flex-1 touch-manipulation rounded-[14px] px-4 py-3 font-bold text-gray-700 hover:brightness-[1.02] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
                  style={PAY_NEO.key}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedEmployee || !earlyOutReason.trim()) {
                      alert('Please enter a reason for early out.');
                      return;
                    }

                    setIsClockLoading(true);

                    try {
                      const pin = prompt(`${selectedEmployee.name}ë‹˜, PINì„ ë‹¤ì‹œ ìž…ë ¥í•´ì£¼ì„¸ìš”:`);
                      if (!pin) {
                        setIsClockLoading(false);
                        return;
                      }

                      const response = await clockInOutApi.clockOut(
                        selectedEmployee.id,
                        pin,
                        true,
                        earlyOutReason,
                        approvedBy
                      );

                      alert(`${selectedEmployee.name}, early out processed.\nTotal hours: ${response.totalHours} hours`);

                      setShowEarlyOutModal(false);
                      setSelectedEmployee(null);
                      setEarlyOutReason('');
                      setApprovedBy('');
                    } catch (error: any) {
                      alert(`Early out failed: ${error.message}`);
                    } finally {
                      setIsClockLoading(false);
                    }
                  }}
                  disabled={!earlyOutReason.trim() || isClockLoading}
                  className={`flex-1 touch-manipulation rounded-[14px] px-4 py-3 font-bold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                    !earlyOutReason.trim() || isClockLoading
                      ? `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                      : NEO_COLOR_BTN_PRESS_NO_SHIFT
                  }`}
                  style={
                    !earlyOutReason.trim() || isClockLoading
                      ? { ...PAY_NEO.inset, color: '#64748b' }
                      : { ...OH_ACTION_NEO.red, borderRadius: 14 }
                  }
                >
                  {isClockLoading ? 'Processing...' : 'Process Early Out'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Sold Out is handled in OrderPage - navigated via 'Sold Out' button */}

      {/* Gift Card Modal */}
      {showGiftCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="relative max-h-[90vh] w-[600px] max-w-[96vw] overflow-hidden border-0 p-0"
            style={{ ...PAY_NEO.modalShell, transform: 'translateY(-70px)' }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
              <h3 className="text-lg font-bold text-slate-800">Gift Card</h3>
              <button
                type="button"
                onClick={() => setShowGiftCardModal(false)}
                className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border-[3px] border-red-500 transition-all hover:brightness-[1.03] ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={MODAL_CLOSE_X_RAISED_STYLE}
                aria-label="Close"
              >
                <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-[min(78vh,720px)] space-y-2 overflow-y-auto px-4 pb-4 pt-2" style={{ background: PAY_NEO_CANVAS }}>
              {/* Section 1: Card Number + Sell/Balance */}
              <div className="rounded-[14px] p-3" style={{ ...PAY_NEO.raised }}>
                <div className="flex gap-3">
                  {/* Card Number */}
                  <div 
                    className={`flex-1 cursor-pointer rounded-[14px] p-3 transition-all ${
                      giftCardInputFocus === 'card' 
                        ? 'ring-2 ring-amber-400/90 ring-offset-2 ring-offset-[#e0e5ec]' 
                        : ''
                    }`}
                    style={{ ...PAY_NEO.inset }}
                    onClick={() => setGiftCardInputFocus('card')}
                  >
                    <div className="mb-1 text-xs font-semibold text-slate-700">Card Number</div>
                    <div className="text-3xl font-mono tracking-wide text-gray-800 flex items-center">
                      {[0, 1, 2, 3].map((groupIdx) => (
                        <span key={groupIdx} className="flex items-center">
                          {[0, 1, 2, 3].map((digitIdx) => {
                            const char = giftCardNumber[groupIdx]?.[digitIdx] || '';
                            return (
                              <span 
                                key={digitIdx} 
                                className={`w-5 inline-flex justify-center ${char ? 'text-gray-800' : 'text-gray-300'}`}
                              >
                                {char || '_'}
                              </span>
                            );
                          })}
                          {groupIdx < 3 && <span className="text-gray-400 mx-1">-</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Sell / Balance Buttons */}
                  <div className="flex flex-col gap-2 w-28">
                    <button
                      type="button"
                      onClick={() => { setGiftCardMode('sell'); setGiftCardBalance(null); setGiftCardError(''); }}
                      className={`flex-1 rounded-[10px] border-0 px-3 py-2 text-sm font-semibold touch-manipulation ${
                        giftCardMode === 'sell' ? `text-white ${NEO_COLOR_BTN_PRESS}` : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                      }`}
                      style={giftCardMode === 'sell' ? GC_NEO_AMBER : { ...PAY_NEO.key }}
                    >
                      Sell
                    </button>
                    <button
                      type="button"
                      onClick={() => { 
                        setGiftCardMode('balance'); 
                        setGiftCardError(''); 
                        // ì¹´ë“œë²ˆí˜¸ê°€ 16ìžë¦¬ë©´ ë°”ë¡œ ìž”ì•¡ ì¡°íšŒ
                        const cardNum = giftCardNumber.join('');
                        if (cardNum.length === 16) {
                          (async () => {
                            try {
                              const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/balance`);
                              if (response.ok) {
                                const data = await response.json();
                                setGiftCardBalance(data.balance);
                              } else {
                                setGiftCardError('Gift card not found');
                              }
                            } catch {
                              setGiftCardError('Failed to connect to server');
                            }
                          })();
                        }
                      }}
                      className={`flex-1 rounded-[10px] border-0 px-3 py-2 text-sm font-semibold touch-manipulation ${
                        giftCardMode === 'balance' ? `text-white ${NEO_COLOR_BTN_PRESS}` : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                      }`}
                      style={giftCardMode === 'balance' ? GC_NEO_GREEN : { ...PAY_NEO.key }}
                    >
                      Balance
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2 & 3: Amount + Bill Buttons + Payment Method (Sell mode only) */}
              {giftCardMode === 'sell' && (
                <div className="flex h-[112px] items-stretch gap-2">
                  <div className="flex gap-2 rounded-[14px] p-2" style={{ ...PAY_NEO.inset }}>
                    <div 
                      className={`flex w-32 cursor-pointer flex-col justify-center rounded-[12px] p-2 transition-all ${
                        giftCardInputFocus === 'amount' 
                          ? 'ring-2 ring-amber-400/90 ring-offset-2 ring-offset-[#e0e5ec]' 
                          : ''
                      }`}
                      style={{ ...PAY_NEO.raised }}
                      onClick={() => setGiftCardInputFocus('amount')}
                    >
                      <div className="mb-1 text-xs font-semibold text-slate-600">Amount</div>
                      <div className="py-2 text-center text-3xl font-bold text-amber-800">
                        ${giftCardAmount || '0'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[25, 50, 100, 200].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => { setGiftCardAmount(String(amt)); setGiftCardInputFocus('amount'); }}
                          className={`h-10 min-h-[40px] w-24 rounded-[10px] border-0 text-sm font-semibold touch-manipulation ${
                            giftCardAmount === String(amt) ? `text-white ${NEO_COLOR_BTN_PRESS}` : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                          }`}
                          style={giftCardAmount === String(amt) ? GC_NEO_AMBER : { ...PAY_NEO.key }}
                        >
                          ${amt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[14px] p-2" style={{ ...PAY_NEO.inset }}>
                    <div className="grid grid-cols-2 gap-2">
                      {(['Cash', 'Visa', 'Master', 'Other'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setGiftCardPaymentMethod(method === 'Master' ? 'MasterCard' : method as any)}
                          className={`h-10 min-h-[40px] w-24 rounded-[10px] border-0 text-sm font-semibold touch-manipulation ${
                            (method === 'Master' ? giftCardPaymentMethod === 'MasterCard' : giftCardPaymentMethod === method)
                              ? `text-white ${NEO_COLOR_BTN_PRESS}`
                              : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                          }`}
                          style={
                            (method === 'Master' ? giftCardPaymentMethod === 'MasterCard' : giftCardPaymentMethod === method)
                              ? { ...PAY_NEO_PRIMARY_BLUE }
                              : { ...PAY_NEO.key }
                          }
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Balance Display (Balance mode only) */}
              {giftCardMode === 'balance' && (
                <div className="flex h-[112px] flex-col justify-center rounded-[14px] p-2 text-center" style={{ ...PAY_NEO.inset }}>
                  <div className="mb-1 text-xs font-semibold text-green-700">Available Balance</div>
                  {giftCardBalance !== null ? (
                    <div className="text-4xl font-bold text-green-700">{`$${giftCardBalance.toFixed(2)}`}</div>
                  ) : (
                    <div className="text-base font-medium text-slate-500">Enter card number and check</div>
                  )}
                </div>
              )}

              <div className="rounded-[14px] p-3" style={{ ...PAY_NEO.inset }}>
                <div className="grid grid-cols-4 gap-2">
                  {(['1', '2', '3', 'C', '4', '5', '6', '\u232B', '7', '8', '9', '', '0', '00', '.', ''] as const).map((key, idx) => (
                    <button
                      key={`numpad-${key}-${idx}`}
                      type="button"
                      onClick={() => {
                        if (giftCardInputFocus === 'card') {
                          // Card number input
                          const fullNumber = giftCardNumber.join('');
                          if (key === 'C') {
                            setGiftCardNumber(['', '', '', '']);
                          } else if (key === '\u232B') {
                            const newNumber = fullNumber.slice(0, -1);
                            const segments = [
                              newNumber.slice(0, 4),
                              newNumber.slice(4, 8),
                              newNumber.slice(8, 12),
                              newNumber.slice(12, 16)
                            ];
                            setGiftCardNumber(segments);
                          } else if (key !== '.' && key !== '00') {
                            if (fullNumber.length < 16) {
                              const newNumber = fullNumber + key;
                              const segments = [
                                newNumber.slice(0, 4),
                                newNumber.slice(4, 8),
                                newNumber.slice(8, 12),
                                newNumber.slice(12, 16)
                              ];
                              setGiftCardNumber(segments);
                            }
                          }
                        } else if (giftCardInputFocus === 'amount') {
                          // Amount input
                          if (key === 'C') {
                            setGiftCardAmount('');
                          } else if (key === '\u232B') {
                            setGiftCardAmount(prev => prev.slice(0, -1));
                          } else if (key === '.') {
                            if (!giftCardAmount.includes('.')) {
                              setGiftCardAmount(prev => prev ? prev + '.' : '0.');
                            }
                          } else {
                            setGiftCardAmount(prev => prev + key);
                          }
                        } else if (giftCardInputFocus === 'pin') {
                          // PIN input
                          if (key === 'C') {
                            setGiftCardSellerPin('');
                          } else if (key === '\u232B') {
                            setGiftCardSellerPin(prev => prev.slice(0, -1));
                          } else if (key !== '.' && key !== '00') {
                            if (giftCardSellerPin.length < 6) {
                              setGiftCardSellerPin(prev => prev + key);
                            }
                          }
                        }
                      }}
                      className={`h-11 min-h-[44px] rounded-[10px] border-0 text-base font-semibold touch-manipulation transition hover:brightness-[1.03] ${
                        key === ''
                          ? 'cursor-default bg-transparent shadow-none'
                          : key === 'C'
                          ? `text-red-700 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                          : key === '\u232B'
                          ? `text-amber-900 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                          : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
                      }`}
                      style={key === '' ? undefined : { ...PAY_KEYPAD_KEY }}
                      disabled={key === ''}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reload Mode Indicator */}
              {giftCardIsReload && giftCardMode === 'sell' && (
                <div className="rounded-[14px] p-2 text-center" style={{ ...PAY_NEO.raised }}>
                  <div className="text-sm font-bold text-blue-800">
                    {`\u{1F504} 충전 모드 — 기존 잔액: $${giftCardExistingBalance?.toFixed(2)}`}
                  </div>
                </div>
              )}

              {giftCardError && (
                <div className="rounded-[14px] px-3 py-2 text-center text-sm text-red-700" style={{ ...PAY_NEO.inset, background: '#fee2e2' }}>
                  <div className="font-medium">{giftCardError}</div>
                </div>
              )}

              <div className="rounded-[14px] p-5" style={{ ...PAY_NEO.raised }}>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[120px] flex-1">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Name</label>
                    <input
                      type="text"
                      value={giftCardCustomerName}
                      readOnly
                      onClick={() => setShowGiftCardNameKeyboard(true)}
                      className="w-full cursor-pointer border-0 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
                      style={{ ...PAY_NEO.inset }}
                      placeholder="Touch to enter"
                    />
                  </div>
                  <div className="min-w-[120px] flex-1">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Phone</label>
                    <input
                      type="tel"
                      value={giftCardCustomerPhone}
                      onChange={(e) => setGiftCardCustomerPhone(e.target.value)}
                      className="w-full border-0 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
                      style={{ ...PAY_NEO.inset }}
                      placeholder="Optional"
                    />
                  </div>
                  {giftCardMode === 'sell' && (
                    <div 
                      className="w-24 min-w-[96px] cursor-pointer"
                      onClick={() => setGiftCardInputFocus('pin')}
                    >
                      <label className="mb-1 block text-xs font-semibold text-red-700">Seller PIN *</label>
                      <div 
                        className={`w-full px-3 py-2 text-center text-sm font-mono tracking-widest text-slate-800 transition-all ${
                          giftCardInputFocus === 'pin' ? 'ring-2 ring-red-500/90 ring-offset-2 ring-offset-[#e0e5ec]' : ''
                        }`}
                        style={{ ...PAY_NEO.inset }}
                      >
                        {giftCardSellerPin ? '\u25CF'.repeat(giftCardSellerPin.length) : <span className="text-slate-500">PIN</span>}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowGiftCardModal(false);
                      setGiftCardIsReload(false);
                      setGiftCardExistingBalance(null);
                      setGiftCardSellerPin('');
                    }}
                    className={`rounded-[12px] border-0 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
                    style={{ ...PAY_NEO.key }}
                  >
                    Cancel
                  </button>
                  {giftCardMode === 'sell' ? (
                    <button
                      type="button"
                      onClick={handleSellGiftCard}
                      className={`rounded-[12px] border-0 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${NEO_COLOR_BTN_PRESS}`}
                      style={giftCardIsReload ? { ...PAY_NEO_PRIMARY_BLUE } : GC_NEO_AMBER}
                    >
                      {giftCardIsReload ? 'Reload' : 'Ok'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckGiftCardBalance}
                      className={`rounded-[12px] border-0 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${NEO_COLOR_BTN_PRESS}`}
                      style={GC_NEO_GREEN}
                    >
                      Ok
                    </button>
                  )}
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Gift Card Sold Popup */}
      {showGiftCardSoldPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="animate-pulse rounded-2xl px-16 py-8 text-white" style={GC_NEO_GREEN}>
            <div className="text-center text-4xl font-bold">Gift Card Sold</div>
          </div>
        </div>
      )}

      {/* Gift Card Reload Popup */}
      {showGiftCardReloadPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="animate-pulse rounded-2xl px-16 py-8 text-white" style={{ ...PAY_NEO_PRIMARY_BLUE, borderRadius: 16 }}>
            <div className="text-center text-4xl font-bold">Gift Card Reloaded</div>
          </div>
        </div>
      )}

      {/* Virtual Keyboard for Gift Card Name */}
      <VirtualKeyboard
        open={showGiftCardNameKeyboard}
        onType={(char) => {
          const shouldCapitalize = giftCardCustomerName.length === 0 || giftCardCustomerName.endsWith(' ');
          const newChar = shouldCapitalize && /[a-z]/i.test(char) ? char.toUpperCase() : char;
          setGiftCardCustomerName(prev => prev + newChar);
        }}
        onBackspace={() => setGiftCardCustomerName(prev => prev.slice(0, -1))}
        onClear={() => setGiftCardCustomerName('')}
        onEnter={() => setShowGiftCardNameKeyboard(false)}
        onRequestClose={() => setShowGiftCardNameKeyboard(false)}
        displayText={giftCardCustomerName}
        showNumpad={true}
        zIndex={99999}
        bottomOffsetPx={0}
      />

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[800px] min-h-[660px] max-h-[85vh] overflow-hidden flex flex-col [&_button]:transition-transform [&_button]:duration-100 [&_button]:ease-out [&_button:not(:disabled)]:active:scale-[0.98] [&_button:not(:disabled)]:active:brightness-95 [&_button]:touch-manipulation" style={{ transform: 'translateY(-80px)' }}>
            {/* Header */}
            <div className="bg-red-600 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">
                {refundStep === 'list' && 'Refund - Select Order'}
                {refundStep === 'detail' && 'Refund - Select Items'}
                {refundStep === 'card_input' && 'Refund - Card Information'}
                {refundStep === 'giftcard_input' && 'Refund - Gift Card Reload'}
                {refundStep === 'confirm' && 'Refund Complete'}
              </h2>
              <button onClick={closeRefundModal} className="text-white hover:text-gray-200 text-5xl font-bold w-14 h-14 flex items-center justify-center rounded-lg hover:bg-red-700 transition-colors">Ã—</button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 min-h-[450px]">
              {/* Step 1: Order List */}
              {refundStep === 'list' && (
                <div className="min-h-[400px]">
                  {/* Search */}
                  <div className="flex gap-3 mb-4">
                    <div className="relative">
                      <button
                        onClick={() => setShowRefundCalendar(!showRefundCalendar)}
                        className="px-5 py-4 border-2 border-blue-400 rounded-xl text-lg font-bold min-w-[200px] cursor-pointer hover:border-blue-600 hover:bg-blue-50 bg-white flex items-center justify-between gap-2"
                        style={{ minHeight: '60px' }}
                      >
                        <span className="text-2xl"></span>
                        <span>{refundSearchDate ? new Date(refundSearchDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select Date'}</span>
                      </button>
                      
                      {/* Custom Calendar Popup */}
                      {showRefundCalendar && (
                        <div className="absolute top-full left-0 mt-2 bg-white border-2 border-gray-300 rounded-xl shadow-2xl z-[100] p-4" style={{ width: '350px' }}>
                          {/* Calendar Header */}
                          <div className="flex justify-between items-center mb-4">
                            <button
                              onClick={() => setRefundCalendarMonth(new Date(refundCalendarMonth.getFullYear(), refundCalendarMonth.getMonth() - 1, 1))}
                              className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-2xl font-bold"
                            >
                              ◀
                            </button>
                            <div className="text-xl font-bold">
                              {refundCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                            </div>
                            <button
                              onClick={() => setRefundCalendarMonth(new Date(refundCalendarMonth.getFullYear(), refundCalendarMonth.getMonth() + 1, 1))}
                              className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-2xl font-bold"
                            >
                              ▶
                            </button>
                          </div>
                          
                          {/* Weekday Headers */}
                          <div className="grid grid-cols-7 gap-1 mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                              <div key={day} className="text-center text-sm font-bold text-gray-600 py-1">
                                {day}
                              </div>
                            ))}
                          </div>
                          
                          {/* Calendar Days */}
                          <div className="grid grid-cols-7 gap-1">
                            {(() => {
                              const year = refundCalendarMonth.getFullYear();
                              const month = refundCalendarMonth.getMonth();
                              const firstDay = new Date(year, month, 1).getDay();
                              const daysInMonth = new Date(year, month + 1, 0).getDate();
                              const days = [];
                              
                              // Empty cells for days before the first of the month
                              for (let i = 0; i < firstDay; i++) {
                                days.push(<div key={`empty-${i}`} className="h-11"></div>);
                              }
                              
                              // Days of the month
                              for (let day = 1; day <= daysInMonth; day++) {
                                const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                                const isSelected = dateStr === refundSearchDate;
                                const isToday = dateStr === getLocalDateString();
                                
                                days.push(
                                  <button
                                    key={day}
                                    onClick={() => {
                                      setRefundSearchDate(dateStr);
                                      setShowRefundCalendar(false);
                                      fetchPaidOrders(dateStr, false);
                                    }}
                                    className={`h-11 w-full rounded-lg text-lg font-semibold transition-all
                                      ${isSelected ? 'bg-blue-600 text-white' : isToday ? 'bg-yellow-200 text-gray-800' : 'bg-gray-100 hover:bg-blue-200 text-gray-800'}
                                    `}
                                  >
                                    {day}
                                  </button>
                                );
                              }
                              
                              return days;
                            })()}
                          </div>
                          
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Order # or Table"
                      value={refundSearchText}
                      onChange={(e) => setRefundSearchText(e.target.value)}
                      className="flex-1 px-4 py-4 border-2 rounded-xl text-lg"
                      style={{ minHeight: '60px' }}
                    />
                    <button
                      onClick={() => {
                        setShowRefundCalendar(false);
                        fetchPaidOrders();
                      }}
                      className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold text-lg shadow-md"
                      style={{ minHeight: '60px' }}
                    >
                      Search
                    </button>
                  </div>

                  {/* Order List */}
                  {refundLoading ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                  ) : refundPaidOrders.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No paid orders found</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
                      {refundPaidOrders.map((order, idx) => {
                        const orderDate = new Date(order.created_at);
                        const dateStr = `${(orderDate.getMonth() + 1).toString().padStart(2, '0')}/${orderDate.getDate().toString().padStart(2, '0')}`;
                        const timeStr = `${orderDate.getHours().toString().padStart(2, '0')}:${orderDate.getMinutes().toString().padStart(2, '0')}`;
                        const customerPhone = order.customer_phone || '';
                        const customerName = order.customer_name || '';
                        const orderType = order.order_type?.toUpperCase() || '';
                        
                        // ì£¼ë¬¸ ì±„ë„ë³„ í‘œì‹œ
                        let channelDisplay = '';
                        let showCustomerInfo = false;
                        if (orderType === 'ONLINE' || order.table_id?.startsWith('OL')) {
                          channelDisplay = 'ONLINE';
                          showCustomerInfo = true;
                        } else if (orderType === 'TOGO' || order.table_id?.startsWith('TG')) {
                          channelDisplay = 'TOGO';
                          showCustomerInfo = true;
                        } else if (orderType === 'TABLEORDER') {
                          channelDisplay = `T-ORD ${order.table_id || ''}`;
                        } else if (orderType === 'QRORDER') {
                          channelDisplay = `QR ${order.table_id || ''}`;
                        } else {
                          // Dine-in (POS)
                          channelDisplay = order.table_id ? `T-${order.table_id}` : 'TOGO';
                          if (!order.table_id) showCustomerInfo = true;
                        }
                        
                        const bgColors = ['bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50'];
                        const bgColor = bgColors[idx % 4];
                        
                        // Check if fully refunded
                        const paidAmount = parseFloat(order.paid_amount) || 0;
                        const refundedAmount = parseFloat(order.refunded_amount) || 0;
                        const isFullyRefunded = refundedAmount >= paidAmount && paidAmount > 0;
                        
                        return (
                          <div
                            key={order.id}
                            onClick={() => !isFullyRefunded && selectOrderForRefund(order)}
                            className={`p-3 border-2 rounded-lg transition-all ease-out touch-manipulation ${
                              isFullyRefunded 
                                ? 'bg-gray-300 border-gray-400 cursor-not-allowed opacity-70' 
                                : `cursor-pointer hover:bg-orange-100 hover:border-orange-400 active:scale-[0.99] active:brightness-95 ${bgColor}`
                            }`}
                            style={{ minHeight: '70px' }}
                          >
                            {/* Fully Refunded Badge */}
                            {isFullyRefunded && (
                              <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded mb-1 inline-block">
                                REFUNDED
                              </div>
                            )}
                            {/* Line 1: ë‚ ì§œ ì£¼ë¬¸ì±„ë„ (ì „ë²ˆ ì´ë¦„ - ONLINE/TOGOë§Œ) */}
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-1">
                              <span>{dateStr} {timeStr}</span>
                              <span className="font-bold text-blue-700">{channelDisplay}</span>
                              {showCustomerInfo && customerPhone && <span className="text-gray-600">{customerPhone}</span>}
                              {showCustomerInfo && customerName && <span className="text-gray-700">{customerName}</span>}
                            </div>
                            {/* Line 2: ê²°ì œë„êµ¬ ê¸ˆì•¡ */}
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">
                                {order.payment_methods || 'N/A'}
                              </span>
                              <span className={`font-bold text-lg ${isFullyRefunded ? 'text-gray-500 line-through' : 'text-green-600'}`}>
                                ${paidAmount.toFixed(2)}
                              </span>
                            </div>
                            {refundedAmount > 0 && !isFullyRefunded && (
                              <div className="text-xs text-red-500 mt-1">
                                Partial Refund: ${refundedAmount.toFixed(2)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Item Selection */}
              {refundStep === 'detail' && refundSelectedOrder && (
                <div className="flex gap-4">
                  {/* Left Column: Order Info, Items, Summary */}
                  <div className="w-1/2">
                    {/* Order Info */}
                    <div className="bg-gray-100 p-2 rounded-lg mb-2">
                      {(() => {
                        const orderDate = new Date(refundSelectedOrder.created_at);
                        const dateStr = `${(orderDate.getMonth() + 1).toString().padStart(2, '0')}/${orderDate.getDate().toString().padStart(2, '0')}`;
                        const timeStr = `${orderDate.getHours().toString().padStart(2, '0')}:${orderDate.getMinutes().toString().padStart(2, '0')}`;
                        const orderType = refundSelectedOrder.order_type?.toUpperCase() || '';
                        const tableId = refundSelectedOrder.table_id || '';
                        
                        let channelDisplay = '';
                        if (orderType === 'ONLINE' || tableId.startsWith('OL')) {
                          channelDisplay = 'ONLINE';
                        } else if (orderType === 'TOGO' || tableId.startsWith('TG')) {
                          channelDisplay = 'TOGO';
                        } else if (orderType === 'TABLEORDER') {
                          channelDisplay = `T-ORD ${tableId}`;
                        } else if (orderType === 'QRORDER') {
                          channelDisplay = `QR ${tableId}`;
                        } else {
                          channelDisplay = tableId ? `T-${tableId}` : 'TOGO';
                        }
                        
                        const customerPhone = refundSelectedOrder.customer_phone || '';
                        const customerName = refundSelectedOrder.customer_name || '';
                        const paymentMethods = refundPayments.map((p: any) => p.method).join(', ') || 'N/A';
                        
                        return (
                          <>
                            {/* Line 1: Date Time Channel Phone Name */}
                            <div className="text-sm font-semibold text-gray-800">
                              <span>{dateStr} {timeStr}</span>
                              <span className="ml-2 font-bold text-blue-700">{channelDisplay}</span>
                              {customerPhone && <span className="ml-2 text-gray-600">({customerPhone})</span>}
                              {customerName && <span className="ml-1 text-gray-700">{customerName}</span>}
                            </div>
                            {/* Line 2: Order Number */}
                            <div className="text-sm font-bold text-gray-900 mt-1">
                              Order #{refundSelectedOrder.order_number}
                            </div>
                            {/* Line 3: Amount & Payment Method */}
                            <div className="text-sm mt-1">
                              <span>
                                Paid: <span className="font-bold text-green-600">{`$${(refundSelectedOrder.totalPaid || 0).toFixed(2)}`}</span>
                                <span className="ml-2 text-gray-600">via {paymentMethods}</span>
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>


                    {/* Items */}
                    <div className="border rounded-lg overflow-hidden mb-2">
                      <div className="bg-gray-50 px-2 py-1 font-semibold text-xs border-b flex">
                        <div className="w-8"></div>
                        <div className="flex-1">Item</div>
                        <div className="w-14 text-center pl-1">Qty</div>
                        <div className="w-14 text-right pl-1">Price</div>
                        <div className="w-14 text-right pl-1">Total</div>
                      </div>
                      <div className="min-h-[263px] max-h-[263px] overflow-y-auto">
                        {refundOrderItems
                          .filter((item) => {
                            // Filter out negative price items (discounts)
                            const unitPrice = item.unit_price || item.price || 0;
                            return unitPrice > 0;
                          })
                          .map((item) => {
                          const isSelected = !!refundSelectedItems[item.id];
                          const selectedQty = refundSelectedItems[item.id] || 0;
                          const maxQty = item.refundable_quantity || 0;
                          const unitPrice = item.unit_price || item.price || 0;
                          
                          return (
                            <div
                              key={item.id}
                              className={`px-2 py-2 border-b flex items-center text-sm ${maxQty === 0 ? 'bg-gray-100 opacity-50' : isSelected ? 'bg-red-50' : ''}`}
                            >
                              <div className="w-8">
                                {maxQty > 0 && (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleRefundItem(item.id, maxQty)}
                                    className="w-7 h-7 cursor-pointer"
                                  />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="font-medium text-sm">{item.name || item.item_name}</div>
                                {item.refunded_quantity > 0 && (
                                  <div className="text-xs text-red-500">Refunded: {item.refunded_quantity}</div>
                                )}
                              </div>
                              <div className="w-14 text-center pl-2">
                                {isSelected && maxQty > 1 ? (
                                  <div className="flex items-center justify-center gap-0.5">
                                    <button
                                      onClick={() => updateRefundItemQty(item.id, selectedQty - 1)}
                                      className="w-5 h-5 bg-gray-200 rounded text-xs font-bold"
                                    >-</button>
                                    <span className="w-5 text-center text-sm">{selectedQty}</span>
                                    <button
                                      onClick={() => updateRefundItemQty(item.id, Math.min(selectedQty + 1, maxQty))}
                                      className="w-5 h-5 bg-gray-200 rounded text-xs font-bold"
                                    >+</button>
                                  </div>
                                ) : (
                                  <span className="pl-2">{maxQty > 0 ? maxQty : '-'}</span>
                                )}
                              </div>
                              <div className="w-14 text-right text-sm">{`$${unitPrice.toFixed(2)}`}</div>
                              <div className="w-14 text-right font-semibold text-sm">
                                {`$${(unitPrice * (isSelected ? selectedQty : maxQty)).toFixed(2)}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Refund Summary */}
                    {(() => {
                      const { subtotal, tax, total } = calculateRefundTotals();
                      return (
                        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-2 mb-2">
                          <div className="flex justify-between text-sm">
                            <span>Subtotal:</span>
                            <span>{`$${subtotal.toFixed(2)}`}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Tax Refund:</span>
                            <span>{`$${tax.toFixed(2)}`}</span>
                          </div>
                          <div className="flex justify-between text-lg font-bold text-red-600 border-t pt-1 mt-1">
                            <span>Total Refund:</span>
                            <span>{`$${total.toFixed(2)}`}</span>
                          </div>
                        </div>
                      );
                    })()}

                  </div>

                  {/* Right Column: Reason, PIN, Numpad */}
                  <div className="w-1/2 flex flex-col gap-3">
                    {/* Reason Section */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          'Food Quality',
                          'Wrong Order',
                          'Cooking Delay',
                          'Delivery Damage',
                          'Duplicate Charge',
                          'Incorrect Amount'
                        ].map((reason) => (
                          <button
                            key={reason}
                            onClick={() => setRefundReason(reason)}
                            className={`px-1 py-4 text-xs rounded-lg border-2 font-bold whitespace-nowrap ${
                              refundReason === reason 
                                ? 'bg-red-600 text-white border-red-600' 
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* PIN + Numpad Section */}
                    <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
                      {/* PIN Input */}
                      <div className="mb-2">
                        <label className="block text-sm font-semibold mb-1 text-red-600">Authorized PIN *</label>
                        <input
                          type="password"
                          value={refundPin}
                          readOnly
                          placeholder="Enter PIN"
                          className="w-full px-2 py-2.5 border-2 border-red-300 rounded-lg text-center text-xl font-mono tracking-widest bg-white"
                        />
                      </div>

                      {/* Numpad */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {['1', '2', '3', 'C', '4', '5', '6', 'âŒ«', '7', '8', '9', '', '.', '0', '00', ''].map((key, idx) => (
                          key === '' ? <div key={idx}></div> : (
                            <button
                              key={key}
                              onClick={() => {
                                if (key === 'C') {
                                  setRefundPin('');
                                } else if (key === 'âŒ«') {
                                  setRefundPin(prev => prev.slice(0, -1));
                                } else if (key === '.' || key === '00') {
                                  // PIN doesn't need . or 00, but keep for consistency
                                  if (refundPin.length < 6) {
                                    setRefundPin(prev => prev + (key === '00' ? '00' : ''));
                                  }
                                } else if (refundPin.length < 6) {
                                  setRefundPin(prev => prev + key);
                                }
                                setRefundPinError('');
                              }}
                              className={`py-3 rounded-lg font-bold text-lg ${
                                key === 'C' ? 'bg-gray-300 text-gray-700' :
                                key === 'âŒ«' ? 'bg-orange-200 text-orange-700' :
                                'bg-white hover:bg-gray-50'
                              }`}
                            >
                              {key}
                            </button>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3a: Card Input for Card Refunds */}
              {refundStep === 'card_input' && refundPendingData && (() => {
                const methodUpper = refundPendingData.paymentMethod?.toUpperCase() || '';
                const isGiftCard = methodUpper === 'GIFT_CARD' || 
                                   methodUpper === 'GIFT CARD' ||
                                   methodUpper === 'GIFT' ||
                                   methodUpper.includes('GIFT');
                return (
                <div className="flex gap-4 h-full">
                  {/* Left: Info & Inputs */}
                  <div className="w-1/2 flex flex-col">
                    <div className={`${isGiftCard ? 'bg-purple-50' : 'bg-blue-50'} p-4 rounded-xl mb-3`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">{isGiftCard ? 'Reload Amount:' : 'Refund Amount:'}</span>
                        <span className={`text-2xl font-bold ${isGiftCard ? 'text-purple-600' : 'text-red-600'}`}>{`$${refundPendingData.total.toFixed(2)}`}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Payment Method:</span>
                        <span className={`text-lg font-semibold ${isGiftCard ? 'text-purple-600' : 'text-blue-600'}`}>{refundPendingData.paymentMethod}</span>
                      </div>
                      {isGiftCard && (
                        <p className="text-sm text-gray-600 mt-2">
                          The refund amount will be reloaded to the gift card.
                        </p>
                      )}
                    </div>

                    {/* Card Number - Different for Gift Card vs Regular Card */}
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1 text-gray-700">
                        {isGiftCard ? 'Gift Card Number (16 Digits) *' : 'Card Number (Last 4 Digits) *'}
                      </label>
                      {isGiftCard ? (
                        <div className="w-full px-3 py-2.5 border-2 border-purple-300 focus-within:border-purple-500 rounded-lg text-center text-2xl font-mono bg-white flex justify-center items-center gap-0">
                          {[0, 1, 2, 3].map((group) => (
                            <span key={group} className="flex items-center">
                              {[0, 1, 2, 3].map((digit) => {
                                const idx = group * 4 + digit;
                                const char = refundGiftCardNumber[idx] || '';
                                return (
                                  <span 
                                    key={idx} 
                                    className={`w-5 h-8 flex items-center justify-center ${char ? 'text-gray-800' : 'text-gray-300'}`}
                                  >
                                    {char || '_'}
                                  </span>
                                );
                              })}
                              {group < 3 && <span className="text-gray-400 mx-1">-</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={refundCardNumber}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '');
                            setRefundCardNumber(value.slice(0, 4));
                          }}
                          placeholder="0000"
                          className="w-full px-3 py-2.5 border-2 border-gray-300 focus:border-blue-500 rounded-lg text-center text-2xl font-mono tracking-widest focus:outline-none"
                          maxLength={4}
                        />
                      )}
                    </div>

                    {/* Approval Number - Only for regular cards */}
                    {!isGiftCard && (
                      <div className="mb-3">
                        <label className="block text-sm font-semibold mb-1 text-gray-700">Card Authorization Code *</label>
                        <input
                          type="text"
                          value={refundApprovalNumber}
                          onChange={(e) => setRefundApprovalNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="From card terminal receipt"
                          className="w-full px-3 py-2.5 border-2 border-gray-300 rounded-lg text-center text-2xl font-mono tracking-widest focus:border-blue-500 focus:outline-none"
                          maxLength={10}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right: Numpad */}
                  <div className="w-1/2 flex flex-col">
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'âŒ«'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (isGiftCard) {
                              // Gift Card: Only card number input
                              if (key === 'C') {
                                setRefundGiftCardNumber('');
                              } else if (key === 'âŒ«') {
                                setRefundGiftCardNumber(refundGiftCardNumber.slice(0, -1));
                              } else {
                                if (refundGiftCardNumber.length < 16) {
                                  setRefundGiftCardNumber(refundGiftCardNumber + key);
                                }
                              }
                            } else {
                              // Regular Card: Card number + Approval number
                              if (key === 'C') {
                                setRefundCardNumber('');
                                setRefundApprovalNumber('');
                              } else if (key === 'âŒ«') {
                                if (refundApprovalNumber) {
                                  setRefundApprovalNumber(refundApprovalNumber.slice(0, -1));
                                } else if (refundCardNumber) {
                                  setRefundCardNumber(refundCardNumber.slice(0, -1));
                                }
                              } else {
                                if (refundCardNumber.length < 4) {
                                  setRefundCardNumber(refundCardNumber + key);
                                } else if (refundApprovalNumber.length < 10) {
                                  setRefundApprovalNumber(refundApprovalNumber + key);
                                }
                              }
                            }
                          }}
                          className={`h-14 text-xl font-bold rounded-lg ${
                            key === 'C' ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                            key === 'âŒ«' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
                            'bg-gray-100 text-gray-800 hover:bg-gray-200'
                          }`}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button 
                        onClick={() => setRefundStep('detail')} 
                        className="py-3 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400"
                      >
                        Back
                      </button>
                      <button
                        onClick={isGiftCard ? processGiftCardRefund : processCardRefund}
                        disabled={refundLoading || (isGiftCard ? !refundGiftCardNumber : (!refundCardNumber || !refundApprovalNumber))}
                        className={`py-3 ${isGiftCard ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg font-semibold disabled:bg-gray-400`}
                      >
                        {refundLoading ? 'Processing...' : (isGiftCard ? 'Reload' : 'Complete')}
                      </button>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* Step 3b: Gift Card Input for Gift Card Refunds */}
              {refundStep === 'giftcard_input' && refundPendingData && (
                <div className="flex gap-4 h-full">
                  {/* Left: Info & Inputs */}
                  <div className="w-1/2 flex flex-col">
                    <div className="bg-purple-50 p-4 rounded-xl mb-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Reload Amount:</span>
                        <span className="text-2xl font-bold text-purple-600">{`$${refundPendingData.total.toFixed(2)}`}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        The refund amount will be reloaded to the gift card.
                      </p>
                    </div>

                    {/* Gift Card Number */}
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1 text-gray-700">Gift Card Number *</label>
                      <input
                        type="text"
                        value={refundGiftCardNumber}
                        onChange={(e) => setRefundGiftCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
                        placeholder="Enter gift card number"
                        className="w-full px-3 py-2.5 border-2 border-purple-300 rounded-lg text-center text-2xl font-mono tracking-widest focus:border-purple-500 focus:outline-none"
                        maxLength={16}
                      />
                    </div>
                  </div>

                  {/* Right: Numpad */}
                  <div className="w-1/2 flex flex-col">
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'âŒ«'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (key === 'C') {
                              setRefundGiftCardNumber('');
                            } else if (key === 'âŒ«') {
                              setRefundGiftCardNumber(refundGiftCardNumber.slice(0, -1));
                            } else {
                              if (refundGiftCardNumber.length < 16) {
                                setRefundGiftCardNumber(refundGiftCardNumber + key);
                              }
                            }
                          }}
                          className={`h-14 text-xl font-bold rounded-lg ${
                            key === 'C' ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                            key === 'âŒ«' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
                            'bg-gray-100 text-gray-800 hover:bg-gray-200'
                          }`}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button 
                        onClick={() => setRefundStep('detail')} 
                        className="py-3 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400"
                      >
                        Back
                      </button>
                      <button
                        onClick={processGiftCardRefund}
                        disabled={refundLoading || !refundGiftCardNumber}
                        className="py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:bg-gray-400"
                      >
                        {refundLoading ? 'Processing...' : 'Reload'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Confirmation */}
              {refundStep === 'confirm' && refundResult && (
                <div className="text-center py-8">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-green-600 mb-2">Refund Processed</h3>
                  <div className="bg-gray-100 rounded-lg p-4 text-left max-w-md mx-auto">
                    <div className="flex justify-between mb-1">
                      <span>Refund ID:</span>
                      <span className="font-semibold">#{refundResult.id}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Original Order:</span>
                      <span className="font-semibold">#{refundResult.originalOrderNumber}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Refund Amount:</span>
                      <span className="font-bold text-red-600">{`$${(refundResult.total || 0).toFixed(2)}`}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Processed by:</span>
                      <span className="font-semibold">{refundResult.refundedBy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Payment Method:</span>
                      <span className="font-semibold">{refundResult.paymentMethod}</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mt-4">Receipt has been printed</div>
                </div>
              )}
            </div>

            {/* Footer - Hidden for card_input and giftcard_input steps */}
            {refundStep !== 'card_input' && refundStep !== 'giftcard_input' && (
            <div className="border-t px-6 py-4 flex justify-between bg-gray-50">
              {refundStep === 'list' && (
                <button onClick={closeRefundModal} className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400">
                  Cancel
                </button>
              )}
              {refundStep === 'detail' && (
                <>
                  <button onClick={() => setRefundStep('list')} className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400">
                    Back
                  </button>
                  <button
                    onClick={processRefund}
                    disabled={refundLoading || Object.keys(refundSelectedItems).length === 0}
                    className="px-8 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:bg-gray-400"
                  >
                    {refundLoading ? 'Processing...' : 'Process Refund'}
                  </button>
                </>
              )}
              {refundStep === 'confirm' && (
                <button onClick={closeRefundModal} className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                  Close
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Refund Success Popup */}
      {showRefundSuccessPopup && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-green-500 text-white px-16 py-8 rounded-2xl shadow-2xl animate-pulse">
            <div className="text-4xl font-bold text-center">Refund Complete</div>
          </div>
        </div>
      )}

      {/* Refund PIN Error Popup */}
      {refundPinError && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-red-600 text-white px-12 py-6 rounded-2xl shadow-2xl">
            <div className="text-2xl font-bold text-center">{refundPinError}</div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* Online Reservation Accept/Reject Popup */}
      {/* ============================================ */}
      {showOnlineReservationPopup && pendingOnlineReservation && (
        <div className="fixed inset-0 flex items-center justify-center z-[9999]" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-white rounded-2xl shadow-2xl" style={{ width: '440px', maxHeight: '90vh', overflow: 'auto' }}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">🪑</span>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-white">New Online Reservation</h2>
                  <p className="text-blue-200 text-sm">A customer has requested a table</p>
                </div>
                <button
                  onClick={() => {
                    if (pendingOnlineReservation?.firebase_doc_id) {
                      processedOnlineReservationIds.current.add(pendingOnlineReservation.firebase_doc_id);
                    }
                    setShowOnlineReservationPopup(false);
                    setPendingOnlineReservation(null);
                  }}
                  className="text-white/70 hover:text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
                  title="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Reservation Details */}
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">Customer</div>
                  <div className="text-base font-bold text-gray-900">{pendingOnlineReservation.customer_name}</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">Phone</div>
                  <div className="text-base font-bold text-gray-900">{pendingOnlineReservation.phone_number}</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-3">
                  <div className="text-xs text-blue-500 mb-1">📅 Date</div>
                  <div className="text-base font-bold text-gray-900">{pendingOnlineReservation.reservation_date}</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-3">
                  <div className="text-xs text-blue-500 mb-1">🕐 Time</div>
                  <div className="text-base font-bold text-gray-900">
                    {(() => {
                      const t = pendingOnlineReservation.reservation_time || '';
                      const [h, m] = t.split(':').map(Number);
                      if (isNaN(h)) return t;
                      const ampm = h >= 12 ? 'PM' : 'AM';
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                    })()}
                  </div>
                </div>
                <div className="bg-green-50 rounded-xl p-3">
                  <div className="text-xs text-green-600 mb-1">👥 Party Size</div>
                  <div className="text-2xl font-extrabold text-gray-900">{pendingOnlineReservation.party_size}</div>
                </div>
                <div className="bg-yellow-50 rounded-xl p-3">
                  <div className="text-xs text-yellow-600 mb-1">🪑 Tables Needed</div>
                  <div className="text-2xl font-extrabold text-gray-900">{pendingOnlineReservation.tables_needed || 1}</div>
                </div>
              </div>

              {pendingOnlineReservation.special_requests && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
                  <div className="text-xs text-amber-600 font-semibold mb-1">📝 Special Requests</div>
                  <div className="text-sm text-amber-900">{pendingOnlineReservation.special_requests}</div>
                </div>
              )}

              {pendingOnlineReservation.deposit_amount > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-5 flex justify-between items-center">
                  <div className="text-sm text-purple-700 font-semibold">💳 Deposit</div>
                  <div className="text-xl font-extrabold text-purple-700">{`$${pendingOnlineReservation.deposit_amount?.toFixed(2)}`}</div>
                </div>
              )}

              <div className="text-xs text-gray-400 text-center mb-4">
                Ref: {pendingOnlineReservation.reservation_number}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleRejectOnlineReservation}
                  disabled={onlineReservationProcessing}
                  className="flex-1 py-4 rounded-xl font-bold text-lg transition-all"
                  style={{
                    backgroundColor: onlineReservationProcessing ? '#d1d5db' : '#fee2e2',
                    color: onlineReservationProcessing ? '#9ca3af' : '#dc2626',
                    border: '2px solid #fecaca',
                    cursor: onlineReservationProcessing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {onlineReservationProcessing ? '...' : '✕  Reject'}
                </button>
                <button
                  onClick={handleAcceptOnlineReservation}
                  disabled={onlineReservationProcessing}
                  className="flex-[2] py-4 rounded-xl font-bold text-lg text-white transition-all"
                  style={{
                    backgroundColor: onlineReservationProcessing ? '#9ca3af' : '#16a34a',
                    cursor: onlineReservationProcessing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {onlineReservationProcessing ? 'Processing...' : '✓  Accept'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SalesPage;


