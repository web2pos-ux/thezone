import React, { Suspense, lazy, useCallback } from 'react';
import { OrderItem } from '../orderTypes';

const PaymentModal = lazy(() => import('../../../components/PaymentModal'));
const SplitBillModal = lazy(() => import('../../../components/SplitBillModal'));

interface PaymentSplitModalsProps {
  showPaymentModal: boolean;
  showSplitBillModal: boolean;
  paymentModalKey: string;
  paymentModalProps: any;
  splitBillModalProps?: SplitBillBridgeProps;
}

interface SplitBillBridgeProps extends Record<string, any> {
  orderItems: OrderItem[];
  setOrderItems?: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onMoveItemToGuest?: (rowIndex: number, targetGuest: number) => void;
  onReorderLeftList?: (sourceRowIndex: number, destIndex: number) => void;
  splitOriginalSnapshotRef?: React.MutableRefObject<OrderItem[] | null>;
  isOpen?: boolean;
  onClose?: () => void;
  onSelectGuest?: (mode: 'ALL' | number) => void;
}

const PaymentSplitModals: React.FC<PaymentSplitModalsProps> = ({
  showPaymentModal,
  showSplitBillModal,
  paymentModalKey,
  paymentModalProps,
  splitBillModalProps,
}) => {
  const {
    orderItems = [],
    setOrderItems,
    onMoveItemToGuest,
    onReorderLeftList,
    splitOriginalSnapshotRef,
    isOpen: splitModalIsOpen,
    onClose: splitModalOnClose,
    onSelectGuest: splitModalOnSelectGuest,
    ...passthroughSplitProps
  } = (splitBillModalProps || {}) as SplitBillBridgeProps;

  const handleSplitItemEqual = useCallback(
    (rowIndex: number) => {
      if (!setOrderItems) return;
      setOrderItems(prev => {
        if (rowIndex < 0 || rowIndex >= prev.length) return prev;
        const src = prev[rowIndex];
        if (!src || src.type === 'separator') return prev;

        const guests = new Set<number>();
        prev.forEach(it => {
          if (it.type !== 'separator') guests.add(it.guestNumber || 1);
        });
        const guestList = Array.from(guests).sort((a, b) => a - b);
        const n = Math.max(1, guestList.length || 1);
        if (n <= 1) return prev;

        const Q = Math.max(1, src.quantity || 1);
        const unitPrice = src.totalPrice;
        const without = prev.filter((_, i) => i !== rowIndex);
        let list = [...without];

        const ensureSep = (g: number) => {
          if (list.findIndex(it => it.type === 'separator' && it.guestNumber === g) === -1) {
            list.push({
              id: `sep-guest-${g}`,
              name: `구분선 Guest ${g}`,
              quantity: 0,
              price: 0,
              totalPrice: 0,
              type: 'separator',
              guestNumber: g,
            } as OrderItem);
          }
        };
        guestList.forEach(ensureSep);

        const insertAfterGuest = (g: number, item: OrderItem) => {
          let sepIdx = list.findIndex(it => it.type === 'separator' && it.guestNumber === g);
          let insertPos = sepIdx + 1;
          for (let i = sepIdx + 1; i < list.length; i++) {
            const it = list[i];
            if (it.type === 'separator') break;
            insertPos = i + 1;
          }
          list = [...list.slice(0, insertPos), item, ...list.slice(insertPos)];
        };

        const wholePerGuest = Math.floor(Q / n);
        const remainderUnits = Q % n;
        const splitPiecePrice = Number((unitPrice / n).toFixed(2));

        if (wholePerGuest > 0) {
          guestList.forEach(g => {
            const wholeClone: OrderItem = {
              ...(src as OrderItem),
              id: `${src.id}-split-${g}-${Date.now()}`,
              guestNumber: g,
              quantity: wholePerGuest,
              totalPrice: unitPrice,
              price: unitPrice,
              type: src.type,
            };
            insertAfterGuest(g, wholeClone);
          });
        }

        if (remainderUnits > 0) {
          guestList.forEach(g => {
            for (let r = 0; r < remainderUnits; r++) {
              const fracClone: OrderItem = {
                ...(src as OrderItem),
                id: `${src.id}-split-${g}-${Date.now()}-${r}`,
                guestNumber: g,
                quantity: 1,
                totalPrice: splitPiecePrice,
                price: splitPiecePrice,
                type: src.type,
              };
              insertAfterGuest(g, fracClone);
            }
          });
        }

        return list;
      });
    },
    [setOrderItems]
  );

  const handleShareSelected = useCallback(
    (rowIndex: number, targets: number[]) => {
      if (!setOrderItems) return;
      if (!Array.isArray(targets) || targets.length === 0) return;
      setOrderItems(prev => {
        if (rowIndex < 0 || rowIndex >= prev.length) return prev;
        const src = prev[rowIndex];
        if (!src || src.type === 'separator') return prev;
        const n = targets.length;
        const Q = Math.max(1, src.quantity || 1);
        let list = prev.filter((_, idx) => idx !== rowIndex);

        const ensureSep = (g: number) => {
          if (list.findIndex(it => it.type === 'separator' && it.guestNumber === g) === -1) {
            list.push({
              id: `sep-guest-${g}`,
              name: `구분선 Guest ${g}`,
              quantity: 0,
              price: 0,
              totalPrice: 0,
              type: 'separator',
              guestNumber: g,
            } as OrderItem);
          }
        };
        targets.forEach(ensureSep);

        const insertAfterGuest = (g: number, item: OrderItem) => {
          let sepIdx = list.findIndex(it => it.type === 'separator' && it.guestNumber === g);
          let insertPos = sepIdx + 1;
          for (let i = sepIdx + 1; i < list.length; i++) {
            const it = list[i];
            if (it.type === 'separator') break;
            insertPos = i + 1;
          }
          list = [...list.slice(0, insertPos), item, ...list.slice(insertPos)];
        };

        const wholePerGuest = Math.floor(Q / n);
        const remainderUnits = Q % n;
        const unitPrice = src.totalPrice;
        const splitPiecePrice = Number((unitPrice / n).toFixed(2));

        targets.forEach(g => {
          if (wholePerGuest > 0) {
            const mergedWhole: OrderItem = {
              ...(src as OrderItem),
              id: `${src.id}-share-${g}-${Date.now()}`,
              guestNumber: g,
              quantity: wholePerGuest,
              totalPrice: unitPrice,
              price: unitPrice,
              type: src.type,
            };
            insertAfterGuest(g, mergedWhole);
          }
        });

        if (remainderUnits > 0) {
          targets.forEach(g => {
            for (let r = 0; r < remainderUnits; r++) {
              const frac: OrderItem = {
                ...(src as OrderItem),
                id: `${src.id}-share-${g}-${Date.now()}-${r}`,
                guestNumber: g,
                quantity: 1,
                totalPrice: splitPiecePrice,
                price: splitPiecePrice,
                type: src.type,
              };
              insertAfterGuest(g, frac);
            }
          });
        }

        return list;
      });
    },
    [setOrderItems]
  );

  const handleResetSplit = useCallback(() => {
    if (splitOriginalSnapshotRef?.current && setOrderItems) {
      setOrderItems(JSON.parse(JSON.stringify(splitOriginalSnapshotRef.current)) as OrderItem[]);
      splitOriginalSnapshotRef.current = null;
      return;
    }
    if (typeof splitBillModalProps?.onResetSplit === 'function') {
      splitBillModalProps.onResetSplit();
    }
  }, [setOrderItems, splitBillModalProps, splitOriginalSnapshotRef]);

  return (
    <>
      {showPaymentModal && (
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="text-white text-xl">Loading...</div>
            </div>
          }
        >
          {PaymentModal ? <PaymentModal key={paymentModalKey} {...paymentModalProps} /> : null}
        </Suspense>
      )}
      {showSplitBillModal && splitBillModalProps && (
        <Suspense fallback={null}>
          {SplitBillModal ? (
            <SplitBillModal
              isOpen={typeof splitModalIsOpen === 'boolean' ? splitModalIsOpen : showSplitBillModal}
              onClose={splitModalOnClose || (() => {})}
              onSelectGuest={splitModalOnSelectGuest || (() => {})}
              {...passthroughSplitProps}
              orderItems={orderItems}
              onMoveItem={(rowIndex: number, targetGuest: number) => {
                if (typeof onMoveItemToGuest === 'function') {
                  onMoveItemToGuest(rowIndex, targetGuest);
                }
              }}
              onReorderLeft={(sourceRowIndex: number, destIndex: number) => {
                if (typeof onReorderLeftList === 'function') {
                  onReorderLeftList(sourceRowIndex, destIndex);
                }
              }}
              onSplitItemEqual={handleSplitItemEqual}
              onShareSelected={handleShareSelected}
              onResetSplit={handleResetSplit}
            />
          ) : null}
        </Suspense>
      )}
    </>
  );
};

export default PaymentSplitModals;

