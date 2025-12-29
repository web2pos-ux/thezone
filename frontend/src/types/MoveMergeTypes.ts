export type MoveEndpointKind = 'table' | 'virtual';

export interface MoveSelectionDescriptor {
  kind: MoveEndpointKind;
  id: string;
  label: string;
  status?: string;
  floor?: string;
  orderId?: string | number;
  tableId?: string;
  virtualTableId?: string;
}

export interface PartialSelectionPayload {
  mode: 'partial' | 'full';
  guestNumbers: number[];
  orderItemIds: Array<number | string>;
  orderLineIds: Array<number | string>;
}

export interface MoveSelectionState {
  sourceId: string | null;
  targetId: string | null;
  descriptors: Record<string, MoveSelectionDescriptor>;
  partialSelection?: PartialSelectionPayload | null;
}

export const buildSelectionKey = (kind: MoveEndpointKind, id: string | number) =>
  `${kind}:${id}`;

export const createInitialMoveSelection = (): MoveSelectionState => ({
  sourceId: null,
  targetId: null,
  descriptors: {},
  partialSelection: null,
});







