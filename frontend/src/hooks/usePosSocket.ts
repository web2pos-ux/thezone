// frontend/src/hooks/usePosSocket.ts
// Socket.io 클라이언트 훅 - 핸드헬드/서브 POS에서 실시간 이벤트 수신

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// 디바이스 타입
export type DeviceType = 'main_pos' | 'sub_pos' | 'handheld' | 'table_order';

// Call Server 요청 타입
export interface CallServerRequest {
  id: string;
  table_id: string;
  table_label: string;
  call_type: 'water' | 'utensils' | 'togo_box' | 'bill' | 'pay_at_table' | 'call_server';
  message: string;
  store_id: string;
  status: 'pending' | 'acknowledged';
  created_at: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
}

// 테이블 상태 변경 이벤트
export interface TableStatusEvent {
  table_id: string;
  element_id?: string;
  status: string;
  current_order_id?: number;
  guests?: number;
}

// 주문 수신 이벤트
export interface OrderReceivedEvent {
  table_id: string;
  order_id: string;
  pos_order_id: number;
  is_new_order: boolean;
  items_count: number;
  total: number;
  server_name?: string;
  source: string;
}

// 훅 옵션
interface UsePosSocketOptions {
  serverUrl: string;
  deviceType: DeviceType;
  deviceName: string;
  onCallServerRequest?: (call: CallServerRequest) => void;
  onCallServerAcknowledged?: (call: CallServerRequest) => void;
  onCallServerDismissed?: (data: { call_id: string }) => void;
  onTableStatusChanged?: (data: TableStatusEvent) => void;
  onOrderReceived?: (data: OrderReceivedEvent) => void;
  onDeviceConnected?: (data: { id: string; type: string; name: string }) => void;
  onDeviceDisconnected?: (data: { id: string; type: string; name: string }) => void;
  onPaymentStarted?: (data: { table_id: string; device_name: string }) => void;
  onPaymentCompleted?: (data: { table_id: string }) => void;
}

interface UsePosSocketReturn {
  isConnected: boolean;
  socket: Socket | null;
  activeCalls: CallServerRequest[];
  acknowledgeCall: (callId: string, acknowledgedBy: string) => void;
  dismissCall: (callId: string) => void;
  emitTableStatusChange: (data: TableStatusEvent) => void;
  reconnect: () => void;
}

export function usePosSocket(options: UsePosSocketOptions): UsePosSocketReturn {
  const {
    serverUrl,
    deviceType,
    deviceName,
    onCallServerRequest,
    onCallServerAcknowledged,
    onCallServerDismissed,
    onTableStatusChanged,
    onOrderReceived,
    onDeviceConnected,
    onDeviceDisconnected,
    onPaymentStarted,
    onPaymentCompleted
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [activeCalls, setActiveCalls] = useState<CallServerRequest[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Socket 연결
  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      return;
    }

    // URL에서 포트 변경 (3177 API 서버로 연결)
    const socketUrl = serverUrl.replace(':3088', ':3177').replace('/api', '');
    
    console.log(`🔌 Connecting to Socket.io: ${socketUrl}`);
    
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`✅ Socket connected: ${socket.id}`);
      setIsConnected(true);

      // 디바이스 등록
      socket.emit('register_device', {
        type: deviceType,
        name: deviceName
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`❌ Socket disconnected: ${reason}`);
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setIsConnected(false);
    });

    // Call Server 이벤트
    socket.on('call_server_request', (call: CallServerRequest) => {
      console.log(`🔔 Call received: ${call.table_label} - ${call.call_type}`);
      setActiveCalls(prev => [call, ...prev.filter(c => c.id !== call.id)]);
      onCallServerRequest?.(call);
    });

    socket.on('call_server_acknowledged', (call: CallServerRequest) => {
      console.log(`✅ Call acknowledged: ${call.table_label}`);
      setActiveCalls(prev => prev.map(c => c.id === call.id ? call : c));
      onCallServerAcknowledged?.(call);
    });

    socket.on('call_server_dismissed', (data: { call_id: string }) => {
      console.log(`🗑️ Call dismissed: ${data.call_id}`);
      setActiveCalls(prev => prev.filter(c => c.id !== data.call_id));
      onCallServerDismissed?.(data);
    });

    // 테이블 상태 변경
    socket.on('table_status_changed', (data: TableStatusEvent) => {
      console.log(`🪑 Table status: ${data.table_id} → ${data.status}`);
      onTableStatusChanged?.(data);
    });

    socket.on('table_updated', (data: TableStatusEvent) => {
      onTableStatusChanged?.(data);
    });

    // 주문 수신
    socket.on('table_order_received', (data: OrderReceivedEvent) => {
      console.log(`📦 Table order: ${data.table_id}`);
      onOrderReceived?.(data);
    });

    socket.on('handheld_order_received', (data: OrderReceivedEvent) => {
      console.log(`📱 Handheld order: ${data.table_id} by ${data.server_name}`);
      onOrderReceived?.(data);
    });

    // 디바이스 연결/해제
    socket.on('device_connected', (data) => {
      console.log(`📱 Device connected: ${data.name} (${data.type})`);
      onDeviceConnected?.(data);
    });

    socket.on('device_disconnected', (data) => {
      console.log(`📴 Device disconnected: ${data.name}`);
      onDeviceDisconnected?.(data);
    });

    // 결제 이벤트
    socket.on('payment_started', (data) => {
      console.log(`💳 Payment started: ${data.table_id}`);
      onPaymentStarted?.(data);
    });

    socket.on('payment_completed', (data) => {
      console.log(`✅ Payment completed: ${data.table_id}`);
      onPaymentCompleted?.(data);
    });

  }, [serverUrl, deviceType, deviceName, onCallServerRequest, onCallServerAcknowledged, onCallServerDismissed, onTableStatusChanged, onOrderReceived, onDeviceConnected, onDeviceDisconnected, onPaymentStarted, onPaymentCompleted]);

  // 연결 해제
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // 재연결
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(connect, 100);
  }, [disconnect, connect]);

  // Call 확인
  const acknowledgeCall = useCallback(async (callId: string, acknowledgedBy: string) => {
    try {
      const apiUrl = serverUrl.replace(':3088', ':3177');
      await fetch(`${apiUrl}/api/call-server/${callId}/acknowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_by: acknowledgedBy })
      });
    } catch (error) {
      console.error('Failed to acknowledge call:', error);
    }
  }, [serverUrl]);

  // Call 무시/완료
  const dismissCall = useCallback(async (callId: string) => {
    try {
      const apiUrl = serverUrl.replace(':3088', ':3177');
      await fetch(`${apiUrl}/api/call-server/${callId}/dismiss`, {
        method: 'PUT'
      });
    } catch (error) {
      console.error('Failed to dismiss call:', error);
    }
  }, [serverUrl]);

  // 테이블 상태 변경 전송
  const emitTableStatusChange = useCallback((data: TableStatusEvent) => {
    socketRef.current?.emit('table_status_changed', data);
  }, []);

  // 컴포넌트 마운트 시 연결
  useEffect(() => {
    if (serverUrl) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [serverUrl, connect, disconnect]);

  return {
    isConnected,
    socket: socketRef.current,
    activeCalls,
    acknowledgeCall,
    dismissCall,
    emitTableStatusChange,
    reconnect
  };
}

export default usePosSocket;

