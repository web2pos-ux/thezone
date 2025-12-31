import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../config/constants';

type ToastKind = 'order' | 'call';

type TableToast = {
  id: string;
  kind: ToastKind;
  tableId: string;
  label: string; // e.g. "Order" or "Water"
  message: string;
  timestamp: Date;
};

function getSocketUrl(apiUrl: string): string {
  return String(apiUrl || '').replace(/\/api\/?$/i, '');
}

export default function TableAlertsOverlay() {
  const socketUrl = useMemo(() => getSocketUrl(API_URL), []);
  const [toasts, setToasts] = useState<TableToast[]>([]);
  const timeoutsRef = useRef<Record<string, number>>({});
  const orderAudioRef = useRef<HTMLAudioElement | null>(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timers = timeoutsRef.current;
    if (timers[id]) {
      try { clearTimeout(timers[id]); } catch {}
      delete timers[id];
    }
  }, []);

  const addToast = useCallback(
    ({ kind, tableId, label }: { kind: ToastKind; tableId: string; label: string }) => {
      const safeTableId = String(tableId || '').trim();
      if (!safeTableId) return;

      const id = `tbl-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const toast: TableToast = {
        id,
        kind,
        tableId: safeTableId,
        label,
        message: kind === 'order' ? `Order from Table ${safeTableId}` : `Table ${safeTableId} - ${label}`,
        timestamp: new Date(),
      };

      setToasts((prev) => [toast, ...prev].slice(0, 8));

      // Sounds
      try {
        if (kind === 'order') {
          if (!orderAudioRef.current) orderAudioRef.current = new Audio('/sounds/Table_Order.mp3');
          orderAudioRef.current.currentTime = 0;
          orderAudioRef.current.play().catch(() => {});
        } else {
          if (!callAudioRef.current) callAudioRef.current = new Audio('/sounds/Call_Server.mp3');
          callAudioRef.current.currentTime = 0;
          callAudioRef.current.play().catch(() => {});
        }
      } catch {}

      // Auto-hide rules:
      // - Order: 5 seconds
      // - Call: NO auto-hide (dismiss on tap only)
      if (kind === 'order') {
        const timeoutId = window.setTimeout(() => removeToast(id), 5000);
        timeoutsRef.current[id] = timeoutId;
      }
    },
    [removeToast]
  );

  useEffect(() => {
    if (!socketUrl) return;

    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('table_order_received', (payload: any) => {
      try {
        const tableId = payload?.table_id ?? payload?.tableId ?? payload?.table ?? payload?.tableNumber;
        if (tableId != null) addToast({ kind: 'order', tableId: String(tableId), label: 'Order' });
      } catch {}
    });

    socket.on('table_call', (payload: any) => {
      try {
        const tableId = payload?.table_id ?? payload?.tableId ?? payload?.table ?? payload?.tableNumber;
        const labelRaw = payload?.kind ?? payload?.type ?? payload?.requestType ?? 'Call Server';
        if (tableId != null) addToast({ kind: 'call', tableId: String(tableId), label: String(labelRaw) });
      } catch {}
    });

    return () => {
      try { socket.removeAllListeners(); } catch {}
      try { socket.disconnect(); } catch {}
    };
  }, [addToast, socketUrl]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-3 py-2 rounded-lg shadow-lg border-l-4 cursor-pointer select-none ${
            t.kind === 'call'
              ? 'bg-red-500 text-white border-red-700'
              : 'bg-yellow-400 text-black border-yellow-600'
          }`}
          style={{ minWidth: '240px' }}
          onClick={() => removeToast(t.id)}
          title="Tap to dismiss"
        >
          <div className="font-bold text-sm">{t.message}</div>
          <div className="text-[11px] opacity-80 mt-1">{t.timestamp.toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  );
}


