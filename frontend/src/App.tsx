import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MenuCacheProvider, prefetchMenuCache } from './contexts/MenuCacheContext';
import { loadSettings } from './config/settings';
import * as constants from './config/constants';

import IntroPage from './pages/IntroPage';
import InitialSetupPage from './pages/InitialSetupPage';
import SetupPage from './pages/SetupPage';
import SalesPage from './pages/SalesPage';
import BackOfficeLayout from './components/BackOfficeLayout';
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
import HandheldPage from './pages/HandheldPage';
import SubPosSetupPage from './pages/SubPosSetupPage';
import SubPosPage from './pages/SubPosPage';
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
import QrCodePage from './pages/QrCodePage';
import KdsPage from './pages/KdsPage';
import ReportManagerPage from './pages/ReportManagerPage';
import GiftCardReportPage from './pages/GiftCardReportPage';
import SalesReportPage from './pages/SalesReportPage';
import PaymentReportPage from './pages/PaymentReportPage';
import CustomerReportPage from './pages/CustomerReportPage';
import InventoryReportPage from './pages/InventoryReportPage';
import DebugPaymentPage from './pages/DebugPaymentPage';
import BackofficeTogoSettingsPage from './pages/BackofficeTogoSettingsPage';
import BackofficeSalesSummaryPage from './pages/BackofficeSalesSummaryPage';
import BasicInfoPage from './pages/BasicInfoPage';
import ReportsDashboardPage from './pages/ReportsDashboardPage';
import PosPromotionsPage from './pages/PosPromotionsPage';
import DealerSettingsPage from './pages/DealerSettingsPage';

// 🚀 OrderPage를 Lazy Loading으로 변경 (8,693줄 → 즉시 로딩 방지)
const OrderPage = lazy(() => import('./pages/OrderPage'));

if (typeof window !== 'undefined') {
  prefetchMenuCache().catch((error) => {
    console.warn('Initial menu prefetch failed:', error);
  });
}

const getStoredOperationMode = (): 'QSR' | 'FSR' | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('pos_setup_config');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { operationMode?: 'QSR' | 'FSR' };
    return parsed?.operationMode ?? null;
  } catch (error) {
    console.warn('Failed to read operation mode from localStorage:', error);
    return null;
  }
};

const SalesModeGate: React.FC = () => {
  const mode = getStoredOperationMode();
  if (mode === 'QSR') {
    return <Navigate to="/qsr" replace />;
  }
  return <SalesPage />;
};

function App() {
  // 앱 시작 시 설정 로드
  useEffect(() => {
    loadSettings().then((settings) => {
      // constants.ts의 전역 변수 업데이트
      (constants as any).API_URL = settings.api_url || constants.API_URL;
      (constants as any).API_BASE = settings.api_base || constants.API_BASE;
      console.log('[App] Settings loaded:', { 
        API_URL: constants.API_URL, 
        API_BASE: constants.API_BASE 
      });
    }).catch((err) => {
      console.warn('[App] Failed to load settings:', err);
    });
  }, []);

  return (
    <MenuCacheProvider>
      <BrowserRouter>
        <Routes>
          {/* 메인 페이지들 - 첫 실행 시 SetupPage로 시작 */}
          <Route path="/" element={<SetupPage />} />
          <Route path="/intro" element={<IntroPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/initial-setup" element={<InitialSetupPage />} />
          
          {/* 고객용 테이블 오더 페이지 */}
          <Route path="/table-order-setup" element={<TableOrderSetupPage />} />
          <Route path="/table-order/:storeId/:tableId" element={<TableOrderPage />} />
          <Route path="/to/:storeId/:tableId" element={<TableOrderPage />} />
          
          {/* 핸드헬드 POS (서버용 주문기) */}
          <Route path="/handheld-setup" element={<HandheldSetupPage />} />
          <Route path="/handheld" element={<HandheldPage />} />
          
          {/* 서브 POS (보조 결제 스테이션) */}
          <Route path="/sub-pos-setup" element={<SubPosSetupPage />} />
          <Route path="/sub-pos" element={<SubPosPage />} />
          
          {/* QSR / 카페 모드 */}
          <Route path="/qsr-setup" element={<QsrSetupPage />} />
          <Route path="/qsr" element={<QsrOrderPage />} />
          <Route path="/qsr-old" element={<QsrPage />} />
          <Route path="/cafe" element={<QsrOrderPage />} />
          
          {/* 딜러/총판 전용 설정 (숨김 경로 - 일반 메뉴에서 접근 불가) */}
          <Route path="/dealer-settings" element={<DealerSettingsPage />} />
          <Route path="/d-cfg" element={<DealerSettingsPage />} /> {/* 단축 경로 */}
          
          <Route path="/sales" element={<SalesModeGate />} />
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
          <Route path="/debug/payment" element={<DebugPaymentPage />} />
          
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
          </Route>
        </Routes>
      </BrowserRouter>
    </MenuCacheProvider>
  );
}

export default App;