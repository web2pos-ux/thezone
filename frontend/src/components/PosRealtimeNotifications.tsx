import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';

type NotificationKind = 'TABLE_ORDER' | 'TABLE_CALL';

type PosNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt: number;
};

const resolveSocketBaseUrl = () => {
  const apiUrl = (process.env.REACT_APP_API_URL || 'http://localhost:3177/api').trim();
  // API_URL is typically ".../api" – socket.io is served on the same host root.
  if (apiUrl.endsWith('/api')) return apiUrl.slice(0, -'/api'.length);
  if (apiUrl.endsWith('/api/')) return apiUrl.slice(0, -'/api/'.length);
  return apiUrl;
};

const shouldEnableForPath = (pathname: string) => {
  if (!pathname) return false;
  // 고객용(테이블 디바이스) 화면에서는 POS 알림을 띄우지 않음
  if (pathname.startsWith('/table-order')) return false;
  if (pathname.startsWith('/to/')) return false;
  return (
    pathname.startsWith('/sales') ||
    pathname.startsWith('/order') ||
    pathname.startsWith('/backoffice') ||
    pathname.startsWith('/debug')
  );
};

const playSound = async (audioRef: React.MutableRefObject<HTMLAudioElement | null>, src: string) => {
  try {
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
    } else if (audioRef.current.src !== window.location.origin + src) {
      audioRef.current.src = src;
    }
    audioRef.current.currentTime = 0;
    await audioRef.current.play();
  } catch (e) {
    // 브라우저 정책상 자동재생이 막힐 수 있음 (사용자 클릭 후 정상)
    console.warn('[POS Notify] sound play blocked:', e);
  }
};

const formatCallTitle = (requestType?: string) => {
  const key = (requestType || 'CALL_SERVER').toString().trim().toUpperCase();
  if (key === 'WATER') return 'Water Request';
  if (key === 'UTENSILS') return 'Utensils Request';
  if (key === 'TOGO BOX' || key === 'TOGO_BOX') return 'Togo Box Request';
  if (key === 'BILL') return 'Bill Request';
  if (key === 'PAY AT TABLE' || key === 'PAY_AT_TABLE') return 'Pay at Table Request';
  return 'Call Server';
};

export const PosRealtimeNotifications: React.FC = () => {
  const location = useLocation();
  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [notifications, setNotifications] = useState<PosNotification[]>([]);

  const enabled = useMemo(() => shouldEnableForPath(location.pathname), [location.pathname]);
  const socketBaseUrl = useMemo(() => resolveSocketBaseUrl(), []);

  const pushNotification = useCallback((n: Omit<PosNotification, 'id' | 'createdAt'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();
    console.log('[POS Notify] pushNotification:', n.title, n.message);
    setNotifications((prev) => {
      const next = [{ ...n, id, createdAt }, ...prev].slice(0, 5);
      console.log('[POS Notify] notifications count:', next.length);
      return next;
    });
    // TABLE_ORDER: 10 seconds auto-dismiss, TABLE_CALL: no auto-dismiss (user must tap)
    if (n.kind === 'TABLE_ORDER') {
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((x) => x.id !== id));
      }, 10000);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    if (socketRef.current) return;

    const socket = io(socketBaseUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[POS Notify] socket connected', socket.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[POS Notify] socket disconnected', reason);
    });

    socket.on('table_order_received', (payload: any) => {
      const tableId = payload?.table_id ? String(payload.table_id) : '';
      const orderId = payload?.order_id ? String(payload.order_id) : '';
      const itemsCount = Number(payload?.items_count || 0);
      pushNotification({
        kind: 'TABLE_ORDER',
        title: 'Table Order Received',
        message: `Table ${tableId}${orderId ? ` / ${orderId}` : ''}${itemsCount ? ` / ${itemsCount} items` : ''}`,
      });
      playSound(audioRef, '/sounds/Table_Order.mp3');
    });

    socket.on('table_call_server', (payload: any) => {
      const tableId = payload?.table_id ? String(payload.table_id) : '';
      const label = payload?.table_label ? String(payload.table_label) : tableId;
      const requestType = payload?.request_type ? String(payload.request_type) : 'CALL_SERVER';
      const msg = payload?.message ? String(payload.message) : '';
      pushNotification({
        kind: 'TABLE_CALL',
        title: `${formatCallTitle(requestType)} - Table ${label || tableId}`,
        message: msg || 'Staff call request received.',
      });
      playSound(audioRef, '/sounds/Call_Server.mp3');
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, socketBaseUrl, pushNotification]);

  if (!enabled) return null;

  return (
    <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-3 pointer-events-none" style={{ zIndex: 999999 }}>
      {notifications.map((n) => {
        const isCall = n.kind === 'TABLE_CALL';
        const bgColor = isCall ? 'bg-orange-500' : 'bg-blue-600';
        return (
          <div
            key={n.id}
            onClick={() => setNotifications((prev) => prev.filter((x) => x.id !== n.id))}
            className={`pointer-events-auto w-[266px] max-w-[90vw] rounded-xl shadow-2xl border-2 ${isCall ? 'border-orange-300' : 'border-blue-300'} ${bgColor} p-3 cursor-pointer hover:opacity-90 transition-opacity`}
            style={{ animation: 'pulse 1s ease-in-out 3' }}
          >
            <div className="text-base font-extrabold text-white truncate flex items-center gap-2">
              <span className="text-xl">{isCall ? '🔔' : '📦'}</span>
              {n.title}
            </div>
            <div className="mt-1 text-sm text-white/90 break-words">{n.message}</div>
          </div>
        );
      })}
    </div>
  );
};

export default PosRealtimeNotifications;


