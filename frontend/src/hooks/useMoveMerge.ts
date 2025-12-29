import { useState, useCallback, useRef, useEffect } from 'react';
import { API_URL } from '../config/constants';
import {
  MoveSelectionState,
  createInitialMoveSelection,
  MoveSelectionDescriptor,
  buildSelectionKey
} from '../types/MoveMergeTypes';

interface TableElement {
  id: string;
  type: string;
  status?: string;
  text?: string;
  floor?: string;
  current_order_id?: number | string | null;
}

interface UseMoveMergeProps {
  selectedFloor: string;
  refreshTableMap: () => Promise<void>;
  onPartialSelectionRequest?: (source: MoveSelectionDescriptor) => void;
}

export const useMoveMerge = ({ selectedFloor, refreshTableMap, onPartialSelectionRequest }: UseMoveMergeProps) => {
  const [isMoveMergeMode, setIsMoveMergeMode] = useState(false);
  const [moveSelection, setMoveSelection] = useState<MoveSelectionState>(createInitialMoveSelection());
  const [moveMergeStatus, setMoveMergeStatus] = useState('');
  const [isMoveMergeExecuting, setIsMoveMergeExecuting] = useState(false);
  
  // Store the last plan key to prevent duplicate execution
  const lastMoveMergePlanKeyRef = useRef<string | null>(null);

  const resetMoveSelection = useCallback(() => {
    setMoveSelection(createInitialMoveSelection());
    setMoveMergeStatus('');
    lastMoveMergePlanKeyRef.current = null;
  }, []);

  const toggleMoveMergeMode = useCallback(() => {
    if (isMoveMergeExecuting) {
      setMoveMergeStatus('⏳ Processing move/merge...');
      return;
    }
    
    if (!isMoveMergeMode) {
      setIsMoveMergeMode(true);
      setMoveMergeStatus('Select a source to move');
      lastMoveMergePlanKeyRef.current = null;
    } else {
      setIsMoveMergeMode(false);
      resetMoveSelection();
    }
  }, [isMoveMergeMode, isMoveMergeExecuting, resetMoveSelection]);

  const handleMoveMergeTableClick = useCallback(async (element: TableElement) => {
    if (!isMoveMergeMode) return;
    if (!(element.type === 'rounded-rectangle' || element.type === 'circle')) return;

    const tableId = String(element.id);
    const status = (element.status || 'Available') as string;
    const label = element.text || `Table ${element.id}`;
    const key = buildSelectionKey('table', tableId);
    const descriptor: MoveSelectionDescriptor = {
      kind: 'table',
      id: tableId,
      label,
      status,
      floor: selectedFloor,
      orderId: element.current_order_id || undefined,
    };

    setMoveSelection((prev: MoveSelectionState) => {
      // 1. Source Selection
      if (!prev.sourceId) {
        if (status !== 'Occupied') {
          setMoveMergeStatus('❌ Source table must be Occupied.');
          return prev;
        }
        setMoveMergeStatus(`✓ Source selected: ${label}`);
        
        // Trigger partial selection request immediately when source is selected
        if (onPartialSelectionRequest) {
            // Use setTimeout to avoid state update conflicts and ensure descriptor is ready if needed
            // We pass the descriptor directly because it's not in state yet
            setTimeout(() => onPartialSelectionRequest(descriptor), 0);
        }
        
        return {
          sourceId: key,
          targetId: null,
          descriptors: {
            ...prev.descriptors,
            [key]: descriptor,
          },
        };
      }

      // 2. Deselect Source
      if (prev.sourceId === key) {
        setMoveMergeStatus('');
        return createInitialMoveSelection();
      }

      // 3. Target Selection
      if (!prev.targetId) {
        if (status !== 'Available' && status !== 'Occupied') {
          setMoveMergeStatus('❌ Destination must be Available or Occupied.');
          return prev;
        }
        setMoveMergeStatus(`→ Destination selected: ${label}`);
        
        // No modal trigger here. Logic moved to auto-execution useEffect.

        return {
          ...prev,
          targetId: key,
          descriptors: {
            ...prev.descriptors,
            [key]: descriptor,
          },
        };
      }

      // 4. Deselect Target
      if (prev.targetId === key) {
        setMoveMergeStatus('');
        const nextDescriptors = { ...prev.descriptors };
        delete nextDescriptors[key];
        return {
          ...prev,
          targetId: null,
          descriptors: nextDescriptors,
        };
      }

      // 5. Change Target
      if (status !== 'Available' && status !== 'Occupied') {
        setMoveMergeStatus('❌ Destination must be Available or Occupied.');
        return prev;
      }

      setMoveMergeStatus(`→ Destination updated: ${label}`);
      const nextDescriptors = { ...prev.descriptors };
      if (prev.targetId) {
        delete nextDescriptors[prev.targetId];
      }
      nextDescriptors[key] = descriptor;
      
      // No modal trigger here.

      return {
        ...prev,
        targetId: key,
        descriptors: nextDescriptors,
      };
    });
  }, [isMoveMergeMode, selectedFloor, onPartialSelectionRequest]);

  const executeMoveMerge = useCallback(async () => {
    const { sourceId, targetId, descriptors } = moveSelection;
    if (!sourceId || !targetId) return;

    const source = descriptors[sourceId];
    const target = descriptors[targetId];

    if (!source || !target) return;

    // Simple validation
    if (source.kind === 'table' && source.status !== 'Occupied') {
      setMoveMergeStatus('❌ Source is not occupied');
      return;
    }

    const planKey = `${sourceId}->${targetId}`;
    if (lastMoveMergePlanKeyRef.current === planKey) {
      return;
    }
    lastMoveMergePlanKeyRef.current = planKey;

    setIsMoveMergeExecuting(true);
    setMoveMergeStatus('⏳ Processing...');

    try {
      const endpoint = target.status === 'Occupied' ? '/merge' : '/move';
      
      // Helper to format descriptor for backend
      const formatForBackend = (desc: MoveSelectionDescriptor) => {
        const base: any = { ...desc };
        if (desc.kind === 'table') {
          base.tableId = desc.id;
          delete base.id;
        } else if (desc.kind === 'virtual') {
          base.virtualTableId = desc.id;
          delete base.id;
        }
        if (!base.floor) {
          base.floor = selectedFloor;
        }
        return base;
      };

      const payload = {
        source: formatForBackend(source),
        target: formatForBackend(target),
        floor: selectedFloor // Global floor context if needed
      };

      if (process.env.NODE_ENV === 'development') {
        console.debug('[MOVE/MERGE] Payload', payload);
      }

      const res = await fetch(`${API_URL}/table-operations${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!result.success) {
        const detail = (result.details || result.stack || '').toString();
        const errorMessage = [result.error || 'Operation failed', detail].filter(Boolean).join(' - ');
        throw new Error(errorMessage);
      }

      setMoveMergeStatus(`✅ Success: ${result.message}`);
      
      // Reset after success
      setTimeout(() => {
        resetMoveSelection();
        setIsMoveMergeMode(false);
        setMoveMergeStatus('');
        refreshTableMap();
      }, 1000);

    } catch (error: any) {
      console.error('Move/Merge failed:', error);
      setMoveMergeStatus(`❌ Error: ${error.message}`);
      // Do not reset lastMoveMergePlanKeyRef here to prevent infinite retry loops if the error persists
      // User must change selection to retry
    } finally {
      setIsMoveMergeExecuting(false);
    }
  }, [moveSelection, selectedFloor, resetMoveSelection, refreshTableMap]);

  // Partial Selection Trigger
  const handlePartialSelectionOpen = useCallback(() => {
    if (!moveSelection.sourceId) return;
    const source = moveSelection.descriptors[moveSelection.sourceId];
    if (onPartialSelectionRequest) {
      onPartialSelectionRequest(source);
    }
  }, [moveSelection, onPartialSelectionRequest]);

  // Auto-execute move/merge when both source and target are selected
  useEffect(() => {
    // Check execution state via ref or just rely on executeMoveMerge's internal plan key check
    // We remove isMoveMergeExecuting from deps to avoid loop when it toggles false
    if (moveSelection.sourceId && moveSelection.targetId) {
      executeMoveMerge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSelection.sourceId, moveSelection.targetId, executeMoveMerge]);

  return {
    isMoveMergeMode,
    setIsMoveMergeMode,
    toggleMoveMergeMode,
    moveSelection,
    setMoveSelection,
    moveMergeStatus,
    setMoveMergeStatus,
    isMoveMergeExecuting,
    handleMoveMergeTableClick,
    executeMoveMerge,
    resetMoveSelection,
    handlePartialSelectionOpen
  };
};

