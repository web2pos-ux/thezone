/**
 * 시리얼 포트 관리 훅
 * COM 포트 프린터 연결을 위한 API 호출 및 상태 관리
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface SerialPort {
  path: string;
  manufacturer: string;
  serialNumber: string;
  vendorId: string;
  productId: string;
  pnpId: string;
  displayName: string;
}

export interface SerialPortOptions {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
}

export interface SerialPortDefaults {
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
}

export interface PrintData {
  title?: string;
  orderInfo?: {
    orderNumber?: string;
    tableName?: string;
    time?: string;
  };
  items?: Array<{
    name: string;
    quantity: number;
    modifiers?: string[];
    memo?: string;
  }>;
  subtotal?: number;
  taxLines?: Array<{ name: string; amount: number }>;
  total?: number;
  footer?: string;
}

/**
 * @param apiBase Optional API root (e.g. http://host:3177/api). Defaults to REACT_APP_API_URL or http://localhost:3177/api.
 */
export function useSerialPorts(apiBase?: string) {
  const baseUrl = useMemo(
    () => (apiBase || process.env.REACT_APP_API_URL || 'http://localhost:3177/api').replace(/\/$/, ''),
    [apiBase]
  );

  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [defaults, setDefaults] = useState<SerialPortDefaults>({
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 시리얼 포트 목록 조회
  const fetchPorts = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${baseUrl}/printers/serial/ports`);
      const data = await response.json();
      
      if (data.success) {
        setPorts(data.ports);
        if (data.defaults) {
          setDefaults(data.defaults);
        }
      } else {
        setError(data.error || 'Failed to fetch serial ports');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  // 특정 포트 사용 가능 여부 확인
  const checkPort = useCallback(async (port: string): Promise<boolean> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/check/${encodeURIComponent(port)}`);
      const data = await response.json();
      return data.success && data.available;
    } catch {
      return false;
    }
  }, [baseUrl]);

  // 테스트 출력
  const testPrint = useCallback(async (
    port: string,
    options?: SerialPortOptions
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, ...options })
      });
      const data = await response.json();
      return data;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [baseUrl]);

  // 일반 출력
  const print = useCallback(async (
    port: string,
    printData: PrintData,
    options?: SerialPortOptions
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, data: printData, options })
      });
      const data = await response.json();
      return data;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [baseUrl]);

  // 키친 티켓 출력
  const printKitchenTicket = useCallback(async (
    port: string,
    ticket: {
      title?: string;
      orderNumber?: string;
      tableName?: string;
      time?: string;
      items: Array<{
        name: string;
        quantity: number;
        modifiers?: string[];
        memo?: string;
      }>;
      footer?: string;
    },
    options?: SerialPortOptions
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/kitchen-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, ticket, options })
      });
      const data = await response.json();
      return data;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [baseUrl]);

  // 영수증 출력
  const printReceipt = useCallback(async (
    port: string,
    receipt: {
      title?: string;
      orderInfo?: {
        orderNumber?: string;
        tableName?: string;
        time?: string;
      };
      items: Array<{
        name: string;
        quantity: number;
        modifiers?: string[];
      }>;
      subtotal: number;
      taxLines?: Array<{ name: string; amount: number }>;
      total: number;
      footer?: { message?: string };
    },
    options?: SerialPortOptions
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, receipt, options })
      });
      const data = await response.json();
      return data;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [baseUrl]);

  // Cash Drawer 열기
  const openCashDrawer = useCallback(async (
    port: string,
    options?: SerialPortOptions
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${baseUrl}/printers/serial/open-drawer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, options })
      });
      const data = await response.json();
      return data;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [baseUrl]);

  // 컴포넌트 마운트 시 포트 목록 조회
  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  return {
    ports,
    defaults,
    loading,
    error,
    fetchPorts,
    checkPort,
    testPrint,
    print,
    printKitchenTicket,
    printReceipt,
    openCashDrawer
  };
}

export default useSerialPorts;
