import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { MenuCacheProvider, prefetchMenuCache } from './contexts/MenuCacheContext';

import IntroPage from './pages/IntroPage';
import InitialSetupPage from './pages/InitialSetupPage';
import SetupPage from './pages/SetupPage';
import SalesPage from './pages/SalesPage';
import BackOfficeLayout from './components/BackOfficeLayout';
import HandheldCallOverlay from './components/HandheldCallOverlay';
import PrintPreviewModalHost from './components/PrintPreviewModalHost';
import { DlqSyncModal } from './components/DlqSyncModal';
import DayOpeningModal from './components/DayOpeningModal';
import MenuListPage from './pages/MenuListPage';
import MenuEditPage from './pages/MenuEditPage';
import MenuItemOptionsPage from './pages/MenuItemOptionsPage';
import CategoryConnectorPage from './pages/CategoryConnectorPage';
import ManagerPinPage from './pages/ManagerPinPage';

import TableMapManagerPage from './pages/TableMapManagerPage';
import TableMapPage from './pages/TableMapPage';
import ScreenSizePage from './pages/ScreenSizePage';
import OrderPageManagerPage from './pages/OrderPageManagerPage';
import OrderSetupPage from './pages/OrderSetupPage';
import PosOrderPage from './pages/PosOrderPage';
import OnlineOrderPage from './pages/OnlineOrderPage';
import QrOrderPage from './pages/QrOrderPage';
import TableOrderPage from './pages/TableOrderPage';
import TableOrderSetupPage from './pages/TableOrderSetupPage';
import HandheldSetupPage from './pages/HandheldSetupPage';
import SubPosSetupPage from './pages/SubPosSetupPage';
import QsrSetupPage from './pages/QsrSetupPage';
import QsrPage from './pages/QsrPage';
import QsrOrderPage from './pages/QsrOrderPage';
import KioskOrderPage from './pages/KioskOrderPage';
import TableReservationSettingsPage from './pages/TableReservationSettingsPage';
import EmployeeManagerPage from './pages/EmployeeManagerPage';
import EmployeeInfoPage from './pages/EmployeeInfoPage';
import AccessPermissionsPage from './pages/AccessPermissionsPage';
import WorkSchedulePage from './pages/WorkSchedulePage';
import ShiftSwapsPage from './pages/ShiftSwapsPage';
import TimeOffRequestPage from './pages/TimeOffRequestPage';
import EmployeeReportPage from './pages/EmployeeReportPage';
import PayrollSettingPage from './pages/PayrollSettingPage';
import HardwareManagerPage from './pages/HardwareManagerPage';
import PrinterPage from './pages/PrinterPage';
import AppSettingsPage from './pages/AppSettingsPage';
import CreditCardReaderPage from './pages/CreditCardReaderPage';
import TableDevicesPage from './pages/TableDevicesPage';
import SubPosSettingsPage from './pages/SubPosSettingsPage';
import QrCodePage from './pages/QrCodePage';
import KdsPage from './pages/KdsPage';
import ReportManagerPage from './pages/ReportManagerPage';
import GiftCardReportPage from './pages/GiftCardReportPage';
import SalesReportPage from './pages/SalesReportPage';
import PaymentReportPage from './pages/PaymentReportPage';
import CustomerReportPage from './pages/CustomerReportPage';
import InventoryReportPage from './pages/InventoryReportPage';
import BackofficeTogoSettingsPage from './pages/BackofficeTogoSettingsPage';
import BackofficeSalesSummaryPage from './pages/BackofficeSalesSummaryPage';
import BasicInfoPage from './pages/BasicInfoPage';
import DeviceSetupPage from './pages/DeviceSetupPage';
import { getAPI_URL } from './config/constants';
import { NetworkSyncStatusProvider, useNetworkSyncStatus } from './contexts/NetworkSyncStatusContext';
import ReportsDashboardPage from './pages/ReportsDashboardPage';
import PosPromotionsPage from './pages/PosPromotionsPage';
import DealerSettingsPage from './pages/DealerSettingsPage';
import ServerSettlementPage from './pages/ServerSettlementPage';
import SettingsTransferPage from './pages/SettingsTransferPage';

// 🚀 OrderPage를 Lazy Loading으로 변경 (8,693줄 → 즉시 로딩 방지)
const OrderPage = lazy(() => import('./pages/OrderPage'));

if (typeof window !== 'undefined') {
  prefetchMenuCache().catch((error) => {
    console.warn('Initial menu prefetch failed:', error);
  });
}

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

// 앱 창 크기(뷰포트) 기준 폰트 조정 — 모니터가 아닌 앱 화면 크기에 비례
// vh/vw 기반 clamp로 스케일, 고정 대형 폰트(34px 등) 오버라이드 제거
const applyScreenSizeVars = () => {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  // JS 고정값 오버라이드 제거 → index.css의 clamp(12px, 1.8vh, 16px) 등 적용
  root.style.removeProperty('--bottom-bar-btn-font');
  root.style.removeProperty('--bottom-bar-btn-height');
  root.style.removeProperty('--order-label-font');
  root.style.removeProperty('--order-value-font');
  root.style.removeProperty('--order-header-font');
  root.style.removeProperty('--order-item-font');
  root.style.removeProperty('--order-mod-font');
  root.style.removeProperty('--order-summary-font');
  root.style.removeProperty('--order-total-font');
  root.style.removeProperty('--sales-footer-height');
};

if (typeof window !== 'undefined') {
  applyScreenSizeVars();
  window.addEventListener('resize', applyScreenSizeVars);
}

const getStoredOperationMode = (): 'QSR' | 'FSR' | 'BISTRO' | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('pos_setup_config');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { operationMode?: string };
    const u = String(parsed?.operationMode || '').toUpperCase();
    if (u === 'QSR') return 'QSR';
    if (u === 'BISTRO') return 'BISTRO';
    if (u === 'FSR') return 'FSR';
    return null;
  } catch (error) {
    console.warn('Failed to read operation mode from localStorage:', error);
    return null;
  }
};

const OpeningRequired: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [err, setErr] = useState<string>('');

  const fetchToday = useCallback(async () => {
    try {
      const apiUrl = getAPI_URL();
      const res = await fetchWithTimeout(`${apiUrl}/daily-closings/today`, { cache: 'no-store' as any });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Failed to load session status');
      }
      setSessionOpen(!!json?.isOpen);
      setErr('');
    } catch (e: any) {
      // Be conservative: if we cannot confirm session is open, keep user at Opening screen.
      setSessionOpen(false);
      setErr(e?.message || 'Failed to load session status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await fetchToday();
    };
    run();
    const t = window.setInterval(() => { fetchToday(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [fetchToday]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (sessionOpen) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gray-100">
      {err && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-sm font-semibold">
          {err}
        </div>
      )}
      <DayOpeningModal
        isOpen={true}
        onClose={() => {
          // Intentionally ignore. Requirement: stay on Opening until completed.
        }}
        onOpeningComplete={() => {
          fetchToday();
        }}
      />
    </div>
  );
};

const SalesModeGate: React.FC = () => {
  const mode = getStoredOperationMode();
  if (mode === 'QSR') {
    return (
      <OpeningRequired>
        <Navigate to="/qsr" replace />
      </OpeningRequired>
    );
  }
  if (mode === 'BISTRO') {
    return (
      <OpeningRequired>
        <Navigate to="/bistro" replace />
      </OpeningRequired>
    );
  }
  return (
    <OpeningRequired>
      <SalesPage />
    </OpeningRequired>
  );
};


const isElectronRenderer = () => {
  try {
    return typeof navigator !== 'undefined' && (navigator.userAgent || '').toLowerCase().includes('electron');
  } catch {
    return false;
  }
};

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';

/**
 * Spec 7 — Minimal English status (fixed corner, brief OK flash).
 * `/sales` 에서는 Firebase 동기 pill 을 SalesPage 헤더(시간 왼쪽)로 옮김.
 * `/bistro` 는 `SalesPage` 재사용(동일 헤더); 플로팅 pill 은 숨기고 헤더 중앙에 동기 상태 표시.
 */
const NetworkStatusBar: React.FC = () => {
  const location = useLocation();
  const {
    browserOnline,
    okFlash,
    disconnectedUi,
    dlq,
    syncActive,
    showAlert,
    title,
    detail,
    onOpenDlq,
  } = useNetworkSyncStatus();
  const hideFloatingSyncPill = location.pathname === '/sales' || location.pathname === '/bistro';

  const pillBase =
    'fixed bottom-3 right-3 z-[10000] max-w-[min(92vw,18rem)] rounded-md border px-2 py-1 shadow-md text-[11px] leading-snug font-medium tracking-tight';

  return (
    <>
      {!browserOnline ? (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-none fixed inset-x-0 top-2 z-[10001] flex justify-center px-2"
        >
          <span className="offline-alert-blink max-w-[min(96vw,36rem)] text-center text-[11px] font-semibold leading-snug text-red-500 [text-shadow:0_0_8px_rgba(0,0,0,0.85),0_1px_2px_rgba(0,0,0,0.75)]">
            You are offline. Check your internet connection.
          </span>
        </div>
      ) : null}
      {okFlash && (
        <div
          role="status"
          aria-live="polite"
          className={`${pillBase} border-emerald-700/50 bg-emerald-950/90 text-emerald-100`}
        >
          Synced
        </div>
      )}
      {showAlert && !okFlash && !hideFloatingSyncPill && (
        <div
          role="status"
          aria-live="polite"
          className={`${pillBase} text-white ${
            disconnectedUi
              ? 'border-amber-800/60 bg-amber-950/92'
              : dlq > 0
                ? 'border-rose-800/60 bg-rose-950/92'
                : syncActive
                  ? 'border-sky-700/50 bg-sky-950/92'
                  : 'border-slate-700/50 bg-slate-950/90'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-0.5">
            <div>
              <div className="font-semibold">{title}</div>
              {detail ? <div className="text-[10px] opacity-85 font-normal">{detail}</div> : null}
            </div>
            {dlq > 0 && onOpenDlq ? (
              <button
                type="button"
                className="shrink-0 text-[10px] underline underline-offset-2 text-white/90 hover:text-white"
                onClick={onOpenDlq}
              >
                Details
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
};

const RequireApprovedDevice: React.FC = () => {
  const location = useLocation();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const hostname = (typeof window !== 'undefined' ? window.location.hostname : '') || '';
    const isRemoteWebClient = !isElectronRenderer() && hostname && !isLocalHost(hostname);

    // Do not gate customer/table-order flows or Back Office.
    const path = location.pathname || '';
    const isExempt =
      path.startsWith('/device-setup') ||
      path.startsWith('/backoffice') ||
      path.startsWith('/table-order') ||
      path.startsWith('/to/') ||
      path.startsWith('/table-order-setup') ||
      path.startsWith('/dealer-settings') ||
      path.startsWith('/d-cfg');

    if (!isRemoteWebClient || isExempt) {
      setAllowed(true);
      return;
    }

    let deviceId = '';
    try {
      deviceId = localStorage.getItem('pos_device_id') || '';
    } catch {}

    if (!deviceId) {
      setAllowed(false);
      return;
    }

    const apiUrl = getAPI_URL();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, API_FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch(`${apiUrl}/devices/${encodeURIComponent(deviceId)}`, { signal: controller.signal, cache: 'no-store' as any });
        if (!res.ok) { setAllowed(false); return; }
        const json = await res.json();
        const status = json?.device?.status;
        setAllowed(status === 'active');

        // keep last_seen updated for approved devices
        if (status === 'active') {
          try {
            await fetchWithTimeout(`${apiUrl}/devices/heartbeat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                device_id: deviceId,
                device_type: 'sub_pos',
                os_version: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
              }),
            }, 4000);
          } catch {}
        }
      } catch {
        if (timedOut) {
          setAllowed(false);
          return;
        }
        if (!controller.signal.aborted) setAllowed(false);
      }
    })();

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [location.pathname]);

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="text-slate-600 font-medium">Checking device registration...</div>
      </div>
    );
  }

  if (!allowed) {
    const from = `${location.pathname}${location.search || ''}`;
    const suggestedType =
      (from.startsWith('/handheld') ? 'handheld' : 'sub_pos');
    return <Navigate to="/device-setup" replace state={{ from, suggestedType }} />;
  }

  return <Outlet />;
};

function App() {
  const [dlqModalOpen, setDlqModalOpen] = useState(false);
  const [dlqRefreshKey, setDlqRefreshKey] = useState(0);

  return (
    <MenuCacheProvider>
      <BrowserRouter>
        <NetworkSyncStatusProvider
          dlqRefreshKey={dlqRefreshKey}
          onOpenDlq={() => setDlqModalOpen(true)}
        >
        <NetworkStatusBar />
        <PrintPreviewModalHost />
        <DlqSyncModal
          isOpen={dlqModalOpen}
          onClose={() => setDlqModalOpen(false)}
          onRetried={() => setDlqRefreshKey((k) => k + 1)}
        />
        <Routes>
          {/* Remote Sub POS registration (iPad/Android/Windows browser) */}
          <Route path="/device-setup" element={<DeviceSetupPage />} />

          {/* 메인 페이지들 - 첫 실행 시 SetupPage로 시작 */}
          <Route element={<RequireApprovedDevice />}>
            <Route path="/" element={<IntroPage />} />
            <Route path="/intro" element={<IntroPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/initial-setup" element={<InitialSetupPage />} />
          
          {/* 고객용 테이블 오더 페이지 */}
          </Route>
          <Route path="/table-order-setup" element={<TableOrderSetupPage />} />
          <Route path="/table-order/:storeId/:tableId" element={<TableOrderPage />} />
          <Route path="/to/:storeId/:tableId" element={<TableOrderPage />} />
          
          {/* 핸드헬드 POS (서버용 주문기) */}
          <Route element={<RequireApprovedDevice />}>
            <Route path="/handheld" element={<HandheldSetupPage />} />
          </Route>
          
          {/* 서브 POS (보조 결제 스테이션) */}
          <Route element={<RequireApprovedDevice />}>
            <Route path="/subpos" element={<SubPosSetupPage />} />
          </Route>
          
          {/* QSR / 카페 모드 */}
          <Route element={<RequireApprovedDevice />}>
            <Route path="/qsr-setup" element={<QsrSetupPage />} />
            <Route path="/qsr" element={<OpeningRequired><QsrOrderPage /></OpeningRequired>} />
            <Route path="/qsr-old" element={<QsrPage />} />
            <Route path="/cafe" element={<OpeningRequired><QsrOrderPage /></OpeningRequired>} />
          
          {/* 딜러/총판 전용 설정 (숨김 경로 - 일반 메뉴에서 접근 불가) */}
          </Route>
          <Route path="/dealer-settings" element={<DealerSettingsPage />} />
          <Route path="/d-cfg" element={<DealerSettingsPage />} /> {/* 단축 경로 */}
          <Route path="/server-settlement" element={<OpeningRequired><ServerSettlementPage /></OpeningRequired>} />
          
          <Route element={<RequireApprovedDevice />}>
            <Route path="/sales" element={<SalesModeGate />} />
            <Route path="/bistro" element={<OpeningRequired><SalesPage /></OpeningRequired>} />
            <Route path="/sales/order" element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-100"><div className="text-xl">Loading...</div></div>}>
                <OrderPage />
              </Suspense>
            } />
            <Route path="/order" element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-100"><div className="text-xl">Loading...</div></div>}>
                <OrderPage />
              </Suspense>
            } />
            <Route path="/debug/payment" element={<Navigate to="/sales/order" replace />} />
          </Route>
          
          {/* Back Office 레이아웃 */}
          <Route path="/backoffice" element={<BackOfficeLayout />}>
            <Route index element={<Navigate to="/backoffice/menu" replace />} />
            <Route path="basic-info" element={<BasicInfoPage />} />
            <Route path="menu" element={<MenuListPage />} />
            <Route path="menu/edit/:menuId" element={<MenuEditPage />} />
            <Route path="menu/:menuId/connect" element={<CategoryConnectorPage />} />
            <Route path="menu/item/:itemId/options" element={<MenuItemOptionsPage />} />
            <Route path="manager-pins" element={<ManagerPinPage />} />

            <Route path="tables" element={<TableMapManagerPage />} />
            <Route path="table-map" element={<TableMapPage />} />
            <Route path="screen-size" element={<ScreenSizePage />} />
            <Route path="orders" element={<OrderPageManagerPage />} />
            <Route path="order-setup" element={<OrderSetupPage />} />
            <Route path="promotions" element={<PosPromotionsPage />} />
            <Route path="pin" element={<PosOrderPage />} />
            <Route path="online-order" element={<OnlineOrderPage />} />
            <Route path="qr-order" element={<QrOrderPage />} />
            <Route path="table-order" element={<TableOrderPage />} />
            <Route path="kiosk-order" element={<KioskOrderPage />} />
            <Route path="table-reservation-settings" element={<TableReservationSettingsPage />} />
            <Route path="employees" element={<EmployeeManagerPage />} />
            <Route path="employee-info" element={<EmployeeInfoPage />} />
            <Route path="access-permissions" element={<AccessPermissionsPage />} />
            <Route path="work-schedule" element={<WorkSchedulePage />} />
            <Route path="shift-swaps" element={<ShiftSwapsPage />} />
            <Route path="time-off-request" element={<TimeOffRequestPage />} />
            <Route path="employee-report" element={<EmployeeReportPage />} />
            <Route path="payroll-setting" element={<PayrollSettingPage />} />
            <Route path="hardware" element={<HardwareManagerPage />} />
            <Route path="printer" element={<PrinterPage />} />
            <Route path="credit-card-reader" element={<CreditCardReaderPage />} />
            <Route path="table-devices" element={<TableDevicesPage />} />
            <Route path="sub-pos-settings" element={<SubPosSettingsPage />} />
            <Route path="qr-code" element={<QrCodePage />} />
            <Route path="kds" element={<KdsPage />} />
            <Route path="app-settings" element={<AppSettingsPage />} />
            <Route path="reports" element={<ReportManagerPage />} />
            <Route path="reports-dashboard" element={<ReportsDashboardPage />} />
            <Route path="sales-report" element={<SalesReportPage />} />
            <Route path="payment-report" element={<PaymentReportPage />} />
            <Route path="customer-report" element={<CustomerReportPage />} />
            <Route path="inventory-report" element={<InventoryReportPage />} />
            <Route path="gift-card-report" element={<GiftCardReportPage />} />
            <Route path="togo-settings" element={<BackofficeTogoSettingsPage />} />
            <Route path="sales-summary" element={<BackofficeSalesSummaryPage />} />
            <Route path="settings-transfer" element={<SettingsTransferPage />} />
          </Route>
        </Routes>
        <HandheldCallOverlay />
        </NetworkSyncStatusProvider>
      </BrowserRouter>
    </MenuCacheProvider>
  );
}

export default App;