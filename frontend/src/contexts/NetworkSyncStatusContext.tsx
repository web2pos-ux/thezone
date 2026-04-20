import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAPI_URL } from '../config/constants';

const API_FETCH_TIMEOUT_MS = 7000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = API_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    window.clearTimeout(timeout);
  }
}

export type NetworkStatusResponse = {
  online?: boolean;
  queuePending?: number;
  queueProcessing?: number;
  queueTotalActive?: number;
  dlqCount?: number;
  queueSyncActive?: boolean;
};

export type NetworkSyncStatusValue = {
  payload: NetworkStatusResponse | null;
  browserOnline: boolean;
  okFlash: boolean;
  /** 백엔드 외부 ping 실패 */
  offline: boolean;
  /**
   * UI에서 'Offline' 앰버·문구를 쓸지 — 브라우저도 오프라인일 때만 true.
   * (백엔드만 offline이면 큐 대기로 표시해 온라인인데 Offline으로 보이는 문제 방지)
   */
  disconnectedUi: boolean;
  pending: number;
  processing: number;
  totalActive: number;
  dlq: number;
  syncActive: boolean;
  showAlert: boolean;
  title: string;
  detail: string;
  onOpenDlq?: () => void;
};

const NetworkSyncStatusContext = createContext<NetworkSyncStatusValue | null>(null);

type ProviderProps = {
  children: React.ReactNode;
  dlqRefreshKey?: number;
  onOpenDlq?: () => void;
};

export function NetworkSyncStatusProvider({ children, dlqRefreshKey = 0, onOpenDlq }: ProviderProps) {
  const [payload, setPayload] = useState<NetworkStatusResponse | null>(null);
  const [okFlash, setOkFlash] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  );
  const prevActiveRef = useRef<number | null>(null);
  const okFlashTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const syncBrowserNet = () => {
      setBrowserOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    };
    syncBrowserNet();
    window.addEventListener('online', syncBrowserNet);
    window.addEventListener('offline', syncBrowserNet);
    return () => {
      window.removeEventListener('online', syncBrowserNet);
      window.removeEventListener('offline', syncBrowserNet);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const apiUrl = getAPI_URL();
        const res = await fetchWithTimeout(`${apiUrl}/network/status`, { cache: 'no-store' as RequestCache });
        const json = (await res.json().catch(() => ({}))) as NetworkStatusResponse;
        if (!cancelled && res.ok) {
          const p = Number(json.queuePending || 0);
          const pr = Number(json.queueProcessing || 0);
          const totalActive =
            json.queueTotalActive != null ? Number(json.queueTotalActive) : p + pr;
          const prev = prevActiveRef.current;
          if (
            prev !== null &&
            prev > 0 &&
            totalActive === 0 &&
            json.online !== false &&
            Number(json.dlqCount || 0) === 0
          ) {
            setOkFlash(true);
            if (okFlashTimerRef.current) window.clearTimeout(okFlashTimerRef.current);
            okFlashTimerRef.current = window.setTimeout(() => {
              okFlashTimerRef.current = undefined;
              setOkFlash(false);
            }, 2200);
          }
          prevActiveRef.current = totalActive;
          setPayload(json);
        }
      } catch {
        if (!cancelled) setPayload(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (okFlashTimerRef.current) {
        window.clearTimeout(okFlashTimerRef.current);
        okFlashTimerRef.current = undefined;
      }
    };
  }, [dlqRefreshKey]);

  const offline = payload?.online === false;
  const disconnectedUi = offline && !browserOnline;
  const pending = Number(payload?.queuePending || 0);
  const processing = Number(payload?.queueProcessing || 0);
  const totalActive =
    payload?.queueTotalActive != null
      ? Number(payload.queueTotalActive)
      : pending + processing;
  const dlq = Number(payload?.dlqCount || 0);
  const syncActive = payload?.queueSyncActive === true || processing > 0;

  const showAlert = payload != null && (offline || dlq > 0 || totalActive > 0 || syncActive);

  const { title, detail } = useMemo(() => {
    let t = '';
    let d = '';
    if (payload) {
      // 진짜 링크 오프라인: 기존 Offline / paused 문구
      if (disconnectedUi) {
        t = 'Offline';
        d =
          totalActive > 0
            ? `Thezone Cloud sync paused · Pending: ${totalActive}`
            : 'Thezone Cloud sync paused';
      } else if (dlq > 0) {
        t = `DLQ: ${dlq}`;
        d = 'Review or retry';
      } else if (syncActive) {
        t = 'Syncing';
        d = totalActive > 0 ? `Pending: ${totalActive}` : 'Sending to cloud';
      } else if (totalActive > 0) {
        // 백엔드만 offline + 브라우저 온라인: 대기 중(곧 재시도) — Offline 라벨 사용 안 함
        t = `Pending: ${totalActive}`;
        d =
          offline && browserOnline
            ? 'Queued for Thezone Cloud — will send when the server can reach the cloud'
            : 'Queued for Thezone Cloud';
      } else if (offline && browserOnline) {
        t = 'Cloud sync';
        d = 'Server reachability check…';
      }
    }
    return { title: t, detail: d };
  }, [payload, offline, browserOnline, disconnectedUi, dlq, syncActive, totalActive]);

  const value = useMemo<NetworkSyncStatusValue>(
    () => ({
      payload,
      browserOnline,
      okFlash,
      offline,
      disconnectedUi,
      pending,
      processing,
      totalActive,
      dlq,
      syncActive,
      showAlert,
      title,
      detail,
      onOpenDlq,
    }),
    [
      payload,
      browserOnline,
      okFlash,
      offline,
      disconnectedUi,
      pending,
      processing,
      totalActive,
      dlq,
      syncActive,
      showAlert,
      title,
      detail,
      onOpenDlq,
    ],
  );

  return (
    <NetworkSyncStatusContext.Provider value={value}>{children}</NetworkSyncStatusContext.Provider>
  );
}

export function useNetworkSyncStatus(): NetworkSyncStatusValue {
  const v = useContext(NetworkSyncStatusContext);
  if (!v) {
    throw new Error('useNetworkSyncStatus must be used within NetworkSyncStatusProvider');
  }
  return v;
}

/** SalesPage 등 Provider 밖에서도 안전하게 쓰기 (null 가능) */
export function useNetworkSyncStatusOptional(): NetworkSyncStatusValue | null {
  return useContext(NetworkSyncStatusContext);
}
